// Stream untrusted archives into application-owned ordinal files, never archive paths.
#include <archive.h>
#include <archive_entry.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <cctype>
#include <clocale>
#include <iostream>
#include <stdexcept>
#include <string>
#include <unordered_set>

constexpr int64_t expandedLimit = 512LL * 1024 * 1024;
constexpr int64_t pageLimit = 32LL * 1024 * 1024;
static std::string clean(const char* raw) {
  if (!raw) throw std::runtime_error("Invalid archive path encoding");
  std::string name(raw);
  std::replace(name.begin(), name.end(), '\\', '/');
  if (name.empty() || name.size() > 2000 || name[0] == '/' ||
      (name.size() > 1 && std::isalpha(static_cast<unsigned char>(name[0])) && name[1] == ':'))
    throw std::runtime_error("Invalid archive path");
  size_t start = 0;
  while (start <= name.size()) {
    const auto end = name.find('/', start);
    const auto part = name.substr(start, end == std::string::npos ? end : end - start);
    if (part == "." || part == "..") throw std::runtime_error("Invalid archive path");
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return name;
}
static bool image(const std::string& name) {
  if (name.rfind("__MACOSX/", 0) == 0 || name[0] == '.' || name.find("/.") != std::string::npos) return false;
  const auto dot = name.rfind('.');
  if (dot == std::string::npos) return false;
  auto ext = name.substr(dot);
  std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return std::tolower(c); });
  return ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" || ext == ".gif";
}
static void json(const std::string& value) {
  std::cout << '"';
  constexpr char hex[] = "0123456789abcdef";
  for (unsigned char c : value) {
    if (c == '"' || c == '\\') std::cout << '\\' << c;
    else if (c < 32) std::cout << "\\u00" << hex[c >> 4] << hex[c & 15];
    else std::cout << c;
  }
  std::cout << '"';
}
int main(int argc, char** argv) {
  if (argc != 3 && argc != 4) return 2;
  std::setlocale(LC_ALL, "");
  const rlimit cpu{30, 31};
  if (setrlimit(RLIMIT_CPU, &cpu) != 0) return 2;
#ifdef __linux__
  const rlimit memory{512ULL * 1024 * 1024, 512ULL * 1024 * 1024};
  if (setrlimit(RLIMIT_AS, &memory) != 0) return 2;
#endif
  const int dir = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (dir < 0) return 2;
  archive* reader = archive_read_new();
  int output = -1;
  try {
    const std::string format(argv[1]);
    archive_read_support_filter_none(reader);
    if (format == "cbz") archive_read_support_format_zip(reader);
    else if (format == "cbr") { archive_read_support_format_rar(reader); archive_read_support_format_rar5(reader); }
    else if (format == "cb7") archive_read_support_format_7zip(reader);
    else if (format == "cbt") archive_read_support_format_tar(reader);
    else throw std::runtime_error("Unsupported archive format");
    const int opened = argc == 4 ? archive_read_open_filename(reader, argv[3], 65536) : archive_read_open_fd(reader, STDIN_FILENO, 65536);
    if (opened != ARCHIVE_OK) throw std::runtime_error("Archive cannot be opened");
    archive_entry* entry;
    int count = 0, pages = 0;
    int64_t declared = 0, expanded = 0;
    std::unordered_set<std::string> names;
    for (;;) {
      const int next = archive_read_next_header(reader, &entry);
      if (next == ARCHIVE_EOF) break;
      if (next != ARCHIVE_OK || ++count > 10000) throw std::runtime_error("Archive headers are invalid or exceed limits");
      const std::string name = clean(archive_entry_pathname_utf8(entry));
      if (!names.insert(name).second) throw std::runtime_error("Duplicate archive path");
      if (archive_entry_is_encrypted(entry)) throw std::runtime_error("Encrypted archives are unsupported");
      const bool known = archive_entry_size_is_set(entry);
      const int64_t size = known ? archive_entry_size(entry) : 0;
      if (size < 0 || size > expandedLimit || (declared += size) > expandedLimit) throw std::runtime_error("Archive expansion limit exceeded");
      const bool selected = archive_entry_filetype(entry) == AE_IFREG && !archive_entry_hardlink(entry) && image(name);
      if (selected && size > pageLimit) throw std::runtime_error("Page byte limit exceeded");
      const auto filename = "page-" + std::to_string(count - 1);
      if (selected) {
        output = openat(dir, filename.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
        if (output < 0) throw std::runtime_error("Cannot create private page file");
      }
      int64_t used = 0;
      char buffer[65536];
      for (;;) {
        const auto read = archive_read_data(reader, buffer, sizeof(buffer));
        if (read == 0) break;
        if (read < 0) throw std::runtime_error("Archive data is damaged or unsupported");
        used += read;
        expanded += read;
        if (expanded > expandedLimit || (selected && used > pageLimit)) throw std::runtime_error("Archive output limit exceeded");
        if (selected) {
          ssize_t at = 0;
          while (at < read) {
            const auto written = write(output, buffer + at, read - at);
            if (written <= 0) throw std::runtime_error("Cannot write private page file");
            at += written;
          }
        }
      }
      if (known && size > 0 && size != used) throw std::runtime_error("Archive entry size mismatch");
      if (selected) {
        if (close(output) != 0) throw std::runtime_error("Cannot close private page file");
        output = -1;
        if (!used) throw std::runtime_error("Empty comic page");
        ++pages;
        std::cout << "{\"slot\":" << count - 1 << ",\"name\":";
        json(name);
        std::cout << ",\"bytes\":" << used << "}" << std::endl;
      }
    }
    if (!pages) throw std::runtime_error("No readable images in archive");
    std::cout << "{\"done\":true,\"entries\":" << count << ",\"expanded\":" << expanded << "}" << std::endl;
    archive_read_free(reader);
    close(dir);
    return 0;
  } catch (const std::exception& error) {
    if (output >= 0) close(output);
    archive_read_free(reader);
    close(dir);
    std::cerr << error.what() << std::endl;
    return 1;
  }
}
