import ts from 'typescript';

// Adopt modules as they are edited; legacy code is deliberately not reformatted in bulk.
export const styleFiles = [
  'scripts/source-style.ts',
  'src/lib/core/lists/sequence.server.ts',
  'src/lib/core/tracking/service.server.ts',
  'src/lib/reading/reader/load.ts',
  'src/lib/reading/reader/comic-source.ts',
  'src/lib/reading/reader/comic-archive.ts',
  'src/lib/reading/reader/archive.ts',
  'tests/reading-comic-source.test.ts',
  'src/lib/reading/reader/engine.ts',
  'src/lib/reading/reader/physical-reader.ts',
  'src/lib/reading/reader/physical-pages.ts',
  'src/lib/reading/reader/physical-pdf.ts',
  'src/lib/reading/reader/physical/book-model.ts',
  'src/lib/reading/reader/physical/lighting.ts',
  'src/lib/reading/reader/physical/materials.ts',
  'src/lib/reading/reader/physical/model.ts',
  'src/lib/reading/reader/physical/orientation.ts',
  'src/lib/reading/reader/physical/page-geometry.ts',
  'src/lib/reading/reader/physical/page-layout.ts',
  'src/lib/reading/reader/physical/page-stack.ts',
  'src/lib/reading/reader/physical/renderer.ts',
  'src/lib/reading/reader/physical/turn-cascade.ts',
  'src/lib/reading/reader/physical/turn-gesture.ts',
  'src/lib/reading/reader/physical/view-motion.ts',
  'src/lib/reading/reader/physical/view.ts',
  'tests/reading-physical.test.ts',
  'src/lib/ui/shelves/discovery.svelte.ts',
  'src/lib/ui/controls/menu-resource.svelte.ts',
  'src/lib/ui/controls/work.svelte.ts',
  'src/lib/catalogue/overrides/presentation.server.ts',
  'src/lib/music/history.server.ts',
  'tests/source-style.test.ts',
  'tests/sequence-transaction-db.test.ts',
];

/** Report adjacent statements collapsed onto one line, ignoring literals and for headers. */
export function compoundStatementLines(text: string, filename = 'source.ts'): number[] {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  function visit(node: ts.Node) {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      let previousEnd = -1;
      for (const statement of node.statements) {
        const start = source.getLineAndCharacterOfPosition(statement.getStart(source)).line;
        if (start === previousEnd) lines.add(start + 1);
        previousEnd = source.getLineAndCharacterOfPosition(statement.getEnd()).line;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...lines].sort((a, b) => a - b);
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  let failures = 0;
  for (const file of files.length ? files : styleFiles) {
    for (const line of compoundStatementLines(await Bun.file(file).text(), file)) {
      console.error(`${file}:${line}: put separate statements on separate lines`);
      failures++;
    }
  }
  if (failures) process.exitCode = 1;
  else console.log(`Source style: ${files.length || styleFiles.length} adopted modules checked.`);
}
