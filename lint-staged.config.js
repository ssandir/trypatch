export default {
  // lint-staged appends the staged file paths to the command.
  '*.{ts,cts,mts,js,cjs,mjs}': 'npm run lint:fix --',
  // Function form ignores the staged file list: passing files to tsc makes it skip tsconfig.json,
  // and a change in one file can break another, so type-check the whole project once.
  '*.{ts,cts,mts}': () => 'npm run type-check',
}
