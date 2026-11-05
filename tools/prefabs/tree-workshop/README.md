# Brickadia Tree Workshop

Open `Brickadia-Tree-Workshop.html` in a current browser. Choose a seed and
settings, select **Generate nursery**, then download both the `.brz` and its
manifest. Paste the nursery once in an empty area in Brickadia. Each tree has
an in-world number. Keep the manifest and report the IDs that have useful
traits; their exact seeds reproduce them for the next generation.

The first version deliberately uses a small, conservative grammar: validated
standard trunks, face-connected studded foliage tiers, and microbrick ID
labels. It generates conifers and broadleaf massing studies. It does not claim
to simulate mature organic branches yet; selection results are intended to
guide those later modules.

Rebuild the self-contained HTML with `node build-workshop.cjs`. Generate the
checked example with `node generate-example.mjs`.
