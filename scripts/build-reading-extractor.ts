import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const target = process.argv[2] ?? resolve(process.env.COAST_DATA_DIR ?? '.data', 'bin/reading-extractor');
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
const compiler = process.platform === 'darwin' ? 'clang++' : 'g++';
const native = process.platform === 'darwin' ? Bun.spawnSync(['brew', '--prefix', 'libarchive']) : undefined;
if (native && native.exitCode !== 0)
    throw new Error('Install libarchive with Homebrew before building.');
const prefix = native?.stdout.toString().trim();
const flags = prefix ? [`-I${prefix}/include`, `-L${prefix}/lib`, `-Wl,-rpath,${prefix}/lib`] : [];
const child = Bun.spawn([compiler, ...flags, '-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', 'scripts/native/reading-extractor.cc', '-larchive', '-o', target], { stdout: 'inherit', stderr: 'inherit' });
if (await child.exited !== 0)
    throw new Error('Install the libarchive development headers and C++ compiler before building the reading extractor.');
