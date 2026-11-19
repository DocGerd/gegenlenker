/**
 * CC0 texture sources of the Blender kit bakes (yard_kit.py, cockpit_interior.py). The scripts read
 * only these JPGs, by path under their `SOURCES_DIR`, and refuse a file whose SHA-256 differs.
 * Poly Haven and ambientCG license every asset CC0 site-wide.
 */
export type KitSource = {
  readonly url: string;
  readonly licence: 'CC0-1.0';
  /** Path under `SOURCES_DIR` -> SHA-256 of the file bytes. */
  readonly files: Readonly<Record<string, string>>;
};

const polyHaven = (id: string, files: Record<string, string>): KitSource => ({
  url: `https://polyhaven.com/a/${id}`,
  licence: 'CC0-1.0',
  files: Object.fromEntries(
    Object.entries(files).map(([map, sha]) => [`${id}/${id}_${map}_2k.jpg`, sha]),
  ),
});

const ambientCg = (id: string, files: Record<string, string>): KitSource => ({
  url: `https://ambientcg.com/a/${id}`,
  licence: 'CC0-1.0',
  files: Object.fromEntries(
    Object.entries(files).map(([map, sha]) => [`${id}/${id}_2K-JPG_${map}.jpg`, sha]),
  ),
});

export const KIT_SOURCES = {
  corrugatedIron: polyHaven('corrugated_iron_02', {
    diff: '1bd2b9900e066d7e6cbacc5093aa4204db71c1bbe13b42a3d8ad23d04fa8075a',
    nor_gl: 'a7972360f64fb44beee57750b0ad6bee1f3b64268cd9f649b5e92e1de4de0632',
    arm: '80ae7f8b9ff7521898049cb79b7cfb82a0bb95bf0cba312ffe1d0e5760f45dcb',
  }),
  concreteFloor: polyHaven('concrete_floor_02', {
    diff: 'b08a20dcb306d08ee7f4a05ec216b19b7fd37e95745998ec5f81ecedaac1f0e9',
    nor_gl: 'ce12d18f283f884f4be6f6c110f81582376049caada1e226958659d3d5fbaae1',
    arm: 'bea1da529cfaf1dba9d127b8ae89793530d261f199409cdebb23abf750306c74',
  }),
  containerSide: polyHaven('container_side', {
    diff: 'f6d88ea2c1f7e6edb3d969af5610017bc8ccf455ef45f99ba5bac60a3963fda4',
    nor_gl: '5bf3d7b304d98bec2065ad2501926cf880e014442bd1457a6a60df79be3a4d34',
    arm: '1000abab0c63c5e755690db659550e53f6668c8bb3adf965198494578cc80e62',
  }),
  facade: ambientCg('Facade001', {
    Color: '6a32358fd3a95f92d0779e9b0a93b1f97a640ff3d451953add5417565e1f6fef',
    NormalGL: '08a50700d418a0110b5367fad7833d526258559bb693c0adc7c1a141de30343f',
    Roughness: '4b7e0b4aa787d20b43f476a2b233ff8518c8a8940e67ffa5feb15e533ba0c81e',
  }),
  corrugatedSteel: ambientCg('CorrugatedSteel007A', {
    Color: 'f7474cf7d802e0c8555eedc86b4c64443cf4a5306605c5ff8b8bc9fba29d8142',
    NormalGL: '20765cbbb31ee9e65486521f4ba9f04f405fd81e0055468d4dabd290223fd39f',
    Roughness: 'e1e09939fc10b251ba1daedbc701e414ade020d5851358cc54ff000065b298be',
    AmbientOcclusion: '943b0f3452a715d0d513e7825e9211a8be29a757cc09d3d484b72b6845dd2280',
  }),
  leafSet: ambientCg('LeafSet009', {
    Color: '9423d1e0d8b06c4733f80cab5eeebf021383f81afabc941708f4d848c484601c',
    Opacity: '77d41bd38c6a97797ac89f13241d7a388cf23f27e1a8db7b787bc046ea5ec969',
  }),
  foliage: ambientCg('Foliage001', {
    Color: '1e95514317c34fe70189879e553fd3baa5ca8092a9d33249837ab79f7aa5bd7c',
    Opacity: '7bb223b929b4f3af27306be1e88b5b3ed5a19590521d7bdd62b6b121f3cecce7',
  }),
  plastic: ambientCg('Plastic006', {
    Color: 'f35b6190d8ec055ffff775849ead3278e32248999b6f047c92103cc40a90e4ca',
    NormalGL: 'b6331bb56ab61eb2dbcea051a93e0819f1025ebe5f9abe215a761a1930cf59af',
    Roughness: '76caae54f89b62ebc0d56ce6b3597bb7b3ebecf7960b189052521622756962b5',
  }),
  fabric: ambientCg('Fabric030', {
    Color: '7aa2ae8d953523c1e7489b4fa7ffd3cfda8f463738db4ddebbbaf126a1ee351a',
    NormalGL: '7c871bf6969e45e5aa11c5d04c7ad141dbc0aadf1124b7eeb9b0b42eb0c8890b',
    Roughness: 'ac4806ea54090d5979f5052eb02f72b27cb01762ebfafa82cce2464e5274c1ec',
    AmbientOcclusion: '19d2e4f9f510f8582412120087bc9326fb42aa6b18fff2666d5b1fd56836dc69',
  }),
  leather: ambientCg('Leather037', {
    Color: 'a9eaa4b723a541062c47c619b20c2399f90d18fb4627c031231b1a6786fe8a13',
    NormalGL: '04b01b79fdb46470af38e1f1ea82bb53b607d6235aa8137b93a5fb41a56c5293',
    Roughness: '801c202182181386969a251470f76b854b47a9236d832f77c4fe736ca2fc6f8e',
  }),
  rubber: ambientCg('Rubber004', {
    Color: '9d560551d0beae1726f98c8a72a12441a01e28413417ebd0c8229bcec20dbcfc',
    NormalGL: '59242ba156992a6cf9f8cb461be117667f8e14d0aad5a6a801f6fc825223d4df',
    Roughness: '84486ce9e73fa0dc4c70ec86ab33e94e409ebdd8ad194f164abf554a167ccdc7',
  }),
} as const satisfies Record<string, KitSource>;

export type KitSourceId = keyof typeof KIT_SOURCES;
