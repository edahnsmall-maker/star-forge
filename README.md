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

**Lighting is baked, not live.** A key light, a cool fill, a tight specular
lobe over a broader sheen, and a Fresnel term that brightens faces seen at a
grazing angle -- that roll-off is most of what reads as glossy plastic. A
small radial hot spot sits on any face catching the light. Faces
above a size threshold fill with a vertical gradient; studs get a gradient
wall and an off-centre radial top. All of it is computed once per viewing
angle into a cached sprite, so the runtime cost of a detailed ship is one
blit.

**Contact shadows are baked in.** Each sprite is rendered a second time as
flat depth, and every pixel is darkened by how much of the hemisphere around
it is blocked by something nearer -- real screen-space ambient occlusion,
computed once per viewing angle at a fixed resolution budget so a 6x desktop
bake costs the same as a 2x flight one. The model also throws a squashed,
blurred silhouette of itself onto the baseplate. Between them they are most
of what separates a render from a photograph of a set.

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
