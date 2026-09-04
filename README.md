# ⚡ Star Forge

A LEGO-style spaceship builder and side-on flying game, built for a
six-year-old. You start with an empty baseplate and build a ship one part at a time --
hull, wings, cockpit, engine, tail, defence, and a minifigure to fly it --
then set off for a planet and unlock more parts.

**Play it:** https://edahnsmall-maker.github.io/star-forge/

Everything is one self-contained `index.html`. No build step, no
dependencies, no server — open the file in a browser and it runs.

## How it's put together

The ships are not drawn as pictures. They're assembled from bricks placed
on a stud grid and rendered in a 3/4 view, the same way a real model goes
together.

**One primitive does all the shapes.** An extruded polygon, with three
optional twists: per-corner top heights (which gives slopes), a tapered top
(cones), and extrusion along z instead of up (horizontal nacelles, antennae,
gun barrels). Rectangles give bricks; swept quads give wedge plates; 12-gons
give round plates and cylinders.

**Parts change how it flies.** Engine power and the tail both set how fast
the ship itself moves; the world scrolls at a rate set by the level alone.
Defence decides what you can shoot. Twenty levels, each a trip to a named planet that swells in the background as
the gems come in. Something new unlocks at almost every level up to sixteen;
the last four are pure difficulty. Defence does not exist for the first two
levels -- it arrives as a reveal once he has flown a bit.
Mission length and balance were set from measured play, not by feel.

**Parts mount, they don't just sit near each other.** Every hull narrows to
the same width at z=7 and z=18, so any cockpit and any engine mate with any
hull. Hulls declare their own `halfW`, and wings are authored from x=0
outward and shifted onto whatever edge they find — so a wing sits flush on a
narrow hull and a wide one alike. Defence and tails mount the same way, off a
`defY`/`defZ` and `tailY`/`tailZ` the hull declares.

**The plastic reflects a room.** A key light and a cool fill give the
diffuse; on top of that every surface mirrors a small analytic studio -- a
soft box overhead, a mid horizon, a dark floor -- sampled along the mirror
direction and mixed in by Schlick Fresnel. It has to be a *mix*, not an add,
so a white brick cannot blow out and a dark one still picks up a real
reflection. This matters because under a directional light an orthographic
camera sees a *constant* specular across any flat face, so a Phong lobe alone
can only tint the colour: gloss done that way reads as "a lighter shade of
blue" rather than as shine.

The soft box is a broad lobe, not a pinpoint. It was `h^16`, which only fires
on faces pointed almost exactly at the light, leaving the top of every brick
matte -- the most visible surfaces in the whole model. Highlights are added
as white rather than mixed into the colour, because a highlight on a dark
blue brick goes near-white in a photograph.

Chamfers carry the loudest cue. A bevel is always closer to grazing than the
face it borders, so it mirrors the studio hard; that hairline along every top
edge is most of what says "injection moulded".

**Studs are lit properly, because there are hundreds of them.** They used to
be painted with hardcoded flat shades that never touched the lighting model,
which left the whole ship matte however well the faces were lit. Each is now
a small glossy cylinder: a narrow specular band and a Fresnel rim on the
wall, a hard crescent on the top placed where the light actually is, so it
sweeps as the model spins.

All of it is computed once per viewing angle into a cached sprite, so the
runtime cost of a detailed ship is one blit.

**Contact shadows are baked in.** Each sprite is rendered a second time as
flat depth, and every pixel is darkened by how much of the hemisphere around
it is blocked by something nearer -- real screen-space ambient occlusion,
computed once per viewing angle at a fixed resolution budget so a desktop
bake costs about what a flight one does. The model also throws a squashed,
blurred silhouette of itself onto the baseplate. Between them they are most
of what separates a render from a photograph of a set.

**The camera is a camera.** Pure axonometric keeps every edge parallel, and
that alone reads as CG -- a photograph of something this small converges, the
far edge of the plate visibly shorter than the near one. The projection
carries a perspective divide at a camera distance of about a long lens.
Sorting is unaffected (it uses view depth, not the projection) and a planar
face stays planar under the divide, so nothing downstream changed.

**There is a depth of field.** A photo of a model this size has a shallow
field: the far corner goes soft while the hull stays sharp. An image that is
uniformly crisp front to back gives itself away whatever the shading does.
The depth pass rendered for the occlusion is reused as the mask, so it costs
one blurred copy per bake and nothing per frame -- and it is only applied to
the build scene, since an asteroid tumbling on its own is all at one distance.

**Light bounces.** A white plate beside a red brick picks up a little red.
A blurred copy of the model, masked back to its own silhouette and added at a
low weight, stands in for a bounce pass: additive, which is the right form,
without knowing which surface it came from.

**Highlights roll off.** Each colour gets a headroom term from its own
luminance, so a highlight on a white brick cannot clip to a flat white patch
the way it does without one. Every brick also carries a tiny deterministic
shade offset, because in a photograph no two are mathematically identical.

**Faces sort individually.** One sort order per whole piece can't describe a
wing plate that stretches from nose to tail, which made pieces pop in and out
during the build-screen spin. Each face carries its own depth instead.

Coordinates: x/z in studs, y in plates (3 plates = 1 brick). Nose at z=0,
tail at z=25.

## Parts come from different sets

Deliberately. A cockpit might be a Classic Space wedge, a City interceptor, a
stone castle turret or a wizard's hat; wings might be swept plates, bat
membrane or a rigged mast with canvas; engines might be ion nacelles or a
pair of broomsticks. They mount the same way regardless, so anything combines
with anything and the results are meant to look a bit mad.

Each option is a whole sub-model rather than a variation on a spaceship
part -- cockpits run 40-70 pieces, a finished ship 100-160. Density comes
from generators (`strip`, `pipes`, `panel`, `railing`, `crate`, `lamp`,
`ladder`, `machine`) so a line of code adds fifteen pieces of texture instead
of fifteen lines.

Newly unlocked options are badged NEW until he looks at them.

## Colour

Each piece carries its real ABS colour and a *role*. The COLOR slot either
leaves them alone ("Classic") or repaints by role, so you can keep the
designed look or make a Frankenstein ship in one palette.

## The model is sized to the screen

The pad and the ship are fitted to the band between the slot tabs and the
controls, at a scale measured from their real projected bounds rather than a
fixed fraction of the screen. Before this the model sat at about a fifth of
the display with a third of the screen empty above it, and at that size none
of the brickwork was legible however well it was lit -- every lighting change
was invisible in the place it was meant to show.

Two details make it work. The pad tracks the ship's own footprint instead of
being a fixed 30x31 plate, and wings are allowed to hang off it the way they
do on a real display stand -- a pad sized to the full wingspan is what was
shrinking everything. And the scale is taken once per ship over all 24 yaw
steps: width from the widest single angle (its corners may bleed slightly at
45 degrees rather than shrink the model), height from the union, so the model
does not grow and shrink as it spins. Typical ships come out 35-125% larger.

## Resolution

The build screen renders at up to 3x device pixels, since it is static and is
where the detail is looked at; flight stays at 2x, since it needs the frames
and the ship is small. A watchdog samples the frame rate and steps the
active scene's cap down rather than dropping frames, so a slow device
degrades in sharpness instead of in feel -- and a heavy build screen does not
cost flight its resolution.

Verified on emulated iPhone 12, Pixel 5 and iPhone SE: a whole ship can be
built by tapping, missions launch, touch steering works, and flight holds
48-58 fps.

## Tools

`tools/` holds the headless checks used to build this. They drive the real
game in a browser rather than testing it in the abstract:

```bash
cd tools && npm install
node play.js       # every slot cycles, scenes advance, win/lose behave
node bot.js .      # plays the game and reports win rate and level length
node rate.js .     # measures crystal collection rate, for sizing the goal
node defense.js    # every defence option destroys rocks and can end a boss
node sheet.js out.png wings   # renders a contact sheet of one slot
node spin2.js      # measures how smoothly the model rotates
```

`bot.js` is the useful one. It plays with a simple dodge-and-collect policy;
`kid`-style variants add random inputs to approximate a young child. Mission
length and defence balance were both set from its numbers, not by feel —
levels used to end in seven seconds and no amount of eyeballing had caught it.

## Development

Edit `index.html` directly. It's one file, ordered: renderer, parts, colour,
scenes, gameplay. The part tables are data — adding a wing means adding an
entry to `WINGS`, not touching the renderer.
