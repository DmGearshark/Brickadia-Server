'use strict';

const fs = require('fs');

// A compact, hand-cleaned transcription of the supplied pixel sprite.
// Spaces remain transparent; every visible cell is a colored square glyph.
const rows = [
  '        PPPP        ',
  '    OOOOPPPPOOOO    ',
  '   OOOOOOPPOOOOOO   ',
  '    OOOOWWWWOOOO    ',
  '       WWWWWW       ',
  '      WYYWWYYW      ',
  '      WBBRRBBW      ',
  '       WWRRWW       ',
  '      WWWWWWWW      ',
  '     RRCCRRCCRR     ',
  '    RRCCRRRRCCRR    ',
  '    RSKCRRRRCKSR    ',
  '    RSSCRRRRCSSR    ',
  '     SSCRRRRCSS     ',
  '      CCRRRRCC      ',
  '      CCRRRRCC      ',
  '     RRRRRRRRRR     ',
  '    RRRRRRRRRRRR    ',
  '   RRRRRRRRRRRRRR   ',
  '   RRRRRRRRRRRRRR   ',
  '    RRRRRRRRRRRR    ',
  '     RRRRRRRRRR     ',
  '  MMRRRR    RRRRMM  ',
  ' MMBRRRYR  RYRRRBMM ',
  'MMBBRRYYRRRRYYRRBBMM',
  '  RRRRYYRRRRYYRRRR  ',
];

const colors = {
  P: '62506f', // hat and dark purple shading
  O: 'f47a13', // orange hair
  W: 'fff8ed', // face and costume white
  Y: 'ffe11a', // yellow makeup and shoes
  B: '176bd1', // blue makeup and shoe accents
  R: 'ef101b', // costume, gloves, and base
  C: '00a9c9', // cyan suspenders
  S: 'bc6d4c', // hands/skin shading
  K: '25252c', // darkest sprite details
  M: 'cb168e', // magenta shoe accents
};

function encode(row) {
  let result = '';
  for (let index = 0; index < row.length;) {
    const symbol = row[index];
    let end = index + 1;
    while (end < row.length && row[end] === symbol) end++;
    const width = end - index;
    result += symbol === ' '
      ? ' '.repeat(width)
      : `<color="${colors[symbol]}">${'■'.repeat(width)}</>`;
    index = end;
  }
  return result.replace(/\s+$/, '');
}

const output = rows.map(encode).join('\r\n');
const destination = process.argv[2] || 'outputs/clown-square-format-string.txt';
fs.writeFileSync(destination, output);
console.log(JSON.stringify({ destination, columns: Math.max(...rows.map(row => row.length)), rows: rows.length,
  characters: output.length, colors: Object.keys(colors).length }, null, 2));
