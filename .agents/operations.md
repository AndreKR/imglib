### Output

`toBuffer()` and `save()` require an explicit `format` of `"png"` or `"jpeg"`,
there's probably no sensible default.

### Resize

`resize()` is the single API for scale/resize/contain/cover behavior.

- Default behavior preserves aspect ratio.
- `mode: "contain"` and `mode: "cover"` are supported.
- `keep_aspect_ratio: false` uses exact dimensions and may distort.
- Enlarging is allowed by default.
- `enlarge: false` forbids enlargement.
- `kernel` selects `"nearest"`, `"cubic"`, `"mitchell"`, `"lanczos2"`, or
  `"lanczos3"`, sharp's default is used when omitted.
- The common "make the longer side fit into 500 px" case is represented by
  `resize({ width: 500, height: 500 })` with the default `"contain"` behavior.

### Overlay

`overlay()` clips overlays that extend beyond the base image. This is an
important difference from raw sharp `composite()`.

Overlay modes:
- `mode: "over"` (default): alpha compositing, source drawn over destination
  only where it's not transparent.
- `mode: "source"`: source pixels replace the destination region, including
  alpha.

### Drawing

Direct methods are preferred over a drawing context callback. For example:

- `image.drawRect(...)`
- `image.drawLine(...)`
- `image.drawCircle(...)`
- `image.drawText(...)`

The goal is to avoid verbose APIs like `img.draw((ctx) => ctx.rect(...))` for
simple primitives.

### Rectangles

`drawRect()` supports two mutually exclusive shapes:

- Size form:
  - `drawRect({ x, y, width, height, ... })`
  - `x`/`y` are the upper-left corner.
  - Positive `width` extends right.
  - Positive `height` extends down.
- Corner form:
  - `drawRect({ x, y, x2, y2, ... })`
  - `x`/`y` are one corner.
  - `x2`/`y2` are the opposite corner.
  - Reversed coordinates are allowed and normalized.

Partial mixtures are disallowed by TypeScript. Do not allow `width` without
`height`, `x2` without `y2`, or size and corner coordinates together.

Rectangle stroke placement:

- Default `strokePosition` is `"center"`, meaning half inside and half outside
  the rectangle bounds.
- `strokePosition: "inside"` keeps the stroke inside the bounds.
- `strokePosition: "outside"` places the stroke outside the bounds.

### Text

`drawText()` uses sharp's native Pango text renderer. Its `x` coordinate is
adjusted by `anchor`. The `verticalAnchor` option controls how `y` is
interpreted:

- `"baseline"` (default): the text baseline.
- `"text-top"`: the top of the actual rendered glyph bounds.
- `"font-top"`: the top of a font-specific ascender box, giving different
- strings a consistent baseline when they share a top coordinate.

A future span system for mixed styling, such as a bold word inside a phrase, is
desired but not implemented yet.

### Colors

`Color.rgb()` deliberately uses positional parameters as an exception to the
general object-parameter convention. Use `Color.css({ value })` for CSS color
strings.

### Threshold

Thresholding is split into explicit operations that preserve channels they do
not target:

- `thresholdLuminance({ threshold? })` converts RGB luminance to pure black or
  white and preserves alpha.
- `thresholdChannels({ threshold? })` thresholds red, green, and blue
  independently and preserves alpha.
- `thresholdAlpha({ threshold? })` thresholds alpha and preserves RGB.

Each uses a normalized threshold from 0 to 1 that defaults to 0.5. Values at or
above the threshold use the high value; values below it use the low value.

### Midtones

There is a curve-based brightness adjustment called
`adjustMidtones({ factor })`. This operation is often called "gamma correction",
but there is another common sequence of operations that is also called "gamma
correction" - it is when you temporarily remove the gamma factor from an image
to apply a (for example resize) operation to the image in linear light power and
then re-apply the gamma factor. To not conflate these two common workflows, this
one is called `adjustMidtones()`.

An actual gamma correction (for operations) or gamma encoding and decoding
operations are not currently provided by the library.

### Alpha / Masks

`attachMask({ mask, channel? })` attaches a separate mask to an image and returns
a restricted `MaskedImage`. A `MaskedImage` can only be used as an overlay source
or converted back to its underlying `Image` with `discardMask()`. This API style
makes it clear that the mask moves together with the overlay coordinates.

The mask is an `Image`, so drawing operations can construct masks.  
Alpha is the default mask channel: transparent pixels are inactive and opaque
pixels are active, regardless of RGB values.  
A luminance (black/white) mask image can be used as a mask by attaching the mask with
`channel: "luminance"`, alpha is then ignored.  
Currently Mask and source dimensions must currently match.  
`Image.blankLike({ image, color? })` creates a transparent image of the same
dimensions, making it convenient to create alpha masks by drawing on it.  
`Color.opaque` is another name for opaque black, conveying the meaning when
drawing on alpha masks.  
The mask remains separate from source alpha so `mode: "source"` can replace a
selected destination pixel with a transparent source pixel without clearing
unselected pixels.
