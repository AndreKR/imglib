# AGENTS.md

## Project

This is a TypeScript image library backed by `sharp`, which provides ordered
operations, drawing primitives and other convenience helpers.

The library currently treats an `Image` as a lazy immutable description of work.
Internally, operations are stored as steps and flushed through sharp when
`toBuffer()`, `save()`, or `metadata()` is called. We deliberately did not add
a separate public `ImagePlan` type; `Image` is the public plan-like object.

We are not trying to optimize by merging steps into a single sharp pipeline yet.
Flushing after each step is acceptable.

The main implementation is in `src/Image.ts`, exported through `src/index.ts`.

All public methods use object parameters, including single-value APIs, to make
editor completion and future API additions easier.

Sources include `Image.file({ path })`, `Image.buffer({ buffer })`, etc.

Operations include
`resize({ width?, height?, keep_aspect_ratio?, enlarge?, mode?, kernel? })`,
`crop({ x, y, width, height, outside? })`,
`overlay({ image, x, y, opacity?, mode? })`
`drawRect({ x, y, width, height, fill?, stroke?, strokeWidth? })`,
`drawText({ value, x, y, size, color, font?, anchor?, verticalAnchor? })`,
`thresholdLuminance({ threshold? })`, `adjustMidtones({ factor })`,
`attachMask({ mask, channel? })`, `invert()`,
`toBuffer({ format, ...encodingOptions })`, etc.

`attachMask()` returns a restricted `MaskedImage`, which can only be used as an
overlay source or converted back to its underlying `Image` with `discardMask()`.

## API decisions

### Immutability

Operations return a new `Image`. They do not mutate the existing image. Keep
this consistent unless there is a very strong reason to introduce mutation.

### Explicit Loading

It is fine to require users to turn buffers/files into `Image` objects before
passing them to operations such as `overlay()`.

## Specific operations

For API decisions about specific operations read the respective section in
.agents/operations.md.

## Tests

Tests are in `tests/image.test.ts`.

The preferred naming style:

- Use `test()`, not `it()`.
- `describe()` groups should be topical, not all wrapped in `describe("Image")`.
- Test descriptions should be capitalized, abbreviated complete sentences/headlines.
- Avoid the popular `it("does something")` style.

The tests are as much documentation as they are technical tests, so make sure
new tests are readable, use the provided test images and reflect real use cases.

Reference images live in `tests/references/` and are tracked by Git.
Generated outputs live in `tests/output/` and are ignored by Git.
The caomparison helper is `tests/helpers/imageAssertions.ts`.

Workflow:

1. Write or modify a test.
2. Run `yarn.cmd test`.
3. If a reference is missing, the helper writes `tests/output/<name>.actual.png`.
4. Visually inspect the output.
5. Manually move the approved file into `tests/references/`.
6. Execute the test again, for convenience the helper removes the "actual" in
   the name.

Mismatch behavior:
- Missing references write an `.actual.png`.
- Pixel mismatches write `.actual.png`, `.expected.png`, and `.diff.png`.
- Dimension mismatches write `.actual.png` and `.expected.png`, then throw a clearer size error.

- On the next test run, the helper should rename them to `ordered-operations-resize-then-crop.png` and `ordered-operations-crop-then-resize.png`.
- Do not be surprised if running tests changes those filenames.

## Important Files

- `src/Image.ts`: main API and implementation.
- `src/index.ts`: public exports.
- `tests/image.test.ts`: integration-style image tests.
- `tests/helpers/imageAssertions.ts`: reference-image comparison and approval helper.
- `tests/images/`: source images used by tests.
- `tests/references/`: approved reference images.
- `tests/output/`: generated candidates and diffs, ignored by Git.

## Open Todos / Design Questions

- Consider docs/JSDoc for the rest of the option interfaces, similar to the rectangle coordinate comments.
- Consider whether `resize()` option names should keep `keep_aspect_ratio` or move toward the project's eventual naming style.
- Drawing primitives currently use source-over compositing, so drawing a transparent
  color does not erase existing pixels. Add an explicit way to replace or erase
  pixels with transparency; possible designs include drawing compositing modes,
  masks, or channel arithmetic.

## Standing Instructions

- The user can make manual edits any time, don't assume code is unchanged when
  overwriting or copying code.
- Do not run `git push` or similar remote operations without asking first.
- This project uses Yarn, not npm. Prefer `yarn.cmd ...` on Windows.
- The repo is configured for Yarn PnP, not zero-install:
  - `.yarnrc.yml` uses `nodeLinker: pnp`.
  - `.yarn/cache`, `.yarn/install-state.gz`, and `.yarn/unplugged` are ignored.
- Do not edit operations.md or approve test reference images unless asked
  explicitly.
