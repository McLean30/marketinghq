# Official Nexai Digital brand files

Put the official logo here as `nexai-logo.png`: the glowing circuit scorpion with the NEXAI DIGITAL wordmark, on a transparent background, cropped to the logo with a little space all round. At least 1200 px wide is ideal.

Then set `"logo": true` in `brand.json` in this folder. Once both are done, HQ uses it automatically:
- in the header;
- as the default logo in Prism's Photo layout and on every AI image (placed whole, aspect kept, never cropped or redrawn by AI);
- as the official logo Calibre checks graphics against, until the owner sets a different one.

Brand colours and the image direction sent to the image model live in `app/js/brand.js`.
