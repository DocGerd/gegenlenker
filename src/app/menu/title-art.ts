// The combination from above, reversing into a bay; colours come from `menu.css`, so it follows the theme.
const MARKUP = `<svg class="menu-art-svg" viewBox="0 0 320 420" aria-hidden="true" focusable="false">
  <rect class="menu-art-ground" x="20" y="10" width="280" height="400" rx="16"/>
  <path class="menu-art-bay" d="M96 24 V214 M224 24 V214 M96 24 H224"/>
  <path class="menu-art-path" d="M160 214 C160 260 176 300 200 344"/>
  <g transform="rotate(-3 160 110)">
    <rect class="menu-art-wheel" x="112" y="48" width="8" height="22" rx="2"/>
    <rect class="menu-art-wheel" x="200" y="48" width="8" height="22" rx="2"/>
    <rect class="menu-art-wheel" x="112" y="160" width="8" height="22" rx="2"/>
    <rect class="menu-art-wheel" x="200" y="160" width="8" height="22" rx="2"/>
    <rect class="menu-art-body" x="118" y="34" width="84" height="158" rx="4"/>
    <circle class="menu-art-turntable" cx="160" cy="172" r="16"/>
    <path class="menu-art-drawbar" d="M160 190 L168 246"/>
  </g>
  <g transform="rotate(9 168 250)">
    <rect class="menu-art-wheel" x="124" y="268" width="8" height="22" rx="2"/>
    <rect class="menu-art-wheel" x="204" y="268" width="8" height="22" rx="2"/>
    <rect class="menu-art-wheel" x="124" y="352" width="8" height="22" rx="2"/>
    <rect class="menu-art-wheel" x="204" y="352" width="8" height="22" rx="2"/>
    <rect class="menu-art-body" x="130" y="250" width="76" height="98" rx="4"/>
    <rect class="menu-art-cab" x="132" y="352" width="72" height="40" rx="6"/>
  </g>
</svg>`;

export function titleArt(): SVGSVGElement {
  const holder = document.createElement('div');
  holder.innerHTML = MARKUP;
  const svg = holder.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error('title art markup is not an svg');
  return svg;
}
