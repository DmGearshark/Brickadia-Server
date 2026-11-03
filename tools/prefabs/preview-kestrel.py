"""Render authored body boxes, with simplified seats and wheel envelopes."""
import json
import sys
import os
from itertools import product

os.environ.setdefault('MPLCONFIGDIR', '/tmp/kestrel-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

source, output = sys.argv[1:]
parts = json.load(open(source))
faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1],
         [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]

def box(ax, position, size, color, alpha=1):
    pts = np.array(list(product([-1, 1], repeat=3))) * size + position
    ax.add_collection3d(Poly3DCollection(
        [pts[f] for f in faces], facecolors=color, edgecolors='#152432',
        linewidths=.35, alpha=alpha, zsort='average'))

def wheel(ax, x, y):
    theta = np.linspace(0, 2*np.pi, 25)
    for radius, depth, color in [(15, 8, '#171c22'), (9, 8.5, '#8d99a2')]:
        rings = [np.array([[x + s*depth/2, y + radius*np.cos(t),
                            -16 + radius*np.sin(t)] for t in theta]) for s in [-1, 1]]
        polygons = [rings[0], rings[1]]
        polygons += [[rings[0][i], rings[0][i+1], rings[1][i+1], rings[1][i]]
                     for i in range(len(theta)-1)]
        ax.add_collection3d(Poly3DCollection(polygons, facecolors=color,
                                             edgecolors='#26323b', linewidths=.3))

fig = plt.figure(figsize=(14, 7), facecolor='#eef2f5')
for n, (azim, title) in enumerate([(48, 'Front three-quarter'), (-135, 'Rear three-quarter')]):
    ax = fig.add_subplot(1, 2, n+1, projection='3d')
    ax.set_facecolor('#eef2f5')
    for part in parts:
        # Main-grid authored boxes use Z-up, zero rotation. Reference wheels
        # and shaped native assets are represented separately below.
        if part['translation'] != [0, 0, 0] or not part['asset'].startswith('PB_'):
            continue
        if part['asset'] not in ('PB_DefaultMicroBrick', 'PB_DefaultBrick'):
            continue
        color=np.array(part['color'])/255
        box(ax, np.array(part['position']), np.array(part['size']), color,
            .28 if part['material']==1 else 1)
    for x in [-20, 20]:
        for y in [-40, 40]:
            wheel(ax, x, y)
    for x in [-10, 10]:
        box(ax, np.array([x, -2, 0]), np.array([7, 9, 2]), '#222d38')
        box(ax, np.array([x, -10, 9]), np.array([7, 2, 9]), '#222d38')
    # Native hinged deck represented by its occupied bounding boxes.
    box(ax, np.array([0,-60,8]), np.array([15,15,4]), np.array([28,108,165])/255)
    box(ax, np.array([0,-73,-2]), np.array([15,2,6]), np.array([28,108,165])/255)
    ax.set(xlim=(-50,50), ylim=(-90,90), zlim=(-32,45))
    ax.set_box_aspect((100,180,77))
    ax.view_init(elev=24, azim=azim)
    ax.set_axis_off()
    ax.set_title(title, fontsize=12, color='#33495b')
fig.suptitle('KESTREL GT — saved body geometry', fontsize=20, color='#173448')
fig.text(.5,.045,'Design preview • native wheels, seats and hinged deck simplified • not an in-game screenshot',
         ha='center', fontsize=10, color='#4a5b68')
plt.subplots_adjust(left=0,right=1,top=.9,bottom=.08,wspace=0)
fig.savefig(output, dpi=160, facecolor=fig.get_facecolor())
