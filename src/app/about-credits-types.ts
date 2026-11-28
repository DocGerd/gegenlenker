export type LicenceText = {
  readonly name: string;
  /** SPDX identifier. */
  readonly spdx: string;
  readonly text: string;
};

export type ThirdParty = LicenceText & {
  /** Runtime dependencies this licence covers; empty when the code is not an npm package. */
  readonly covers: readonly string[];
  /** Transitive packages in the bundle that ship under the same licence text. */
  readonly bundled: readonly string[];
  /** The file in `public/licenses/`. */
  readonly file: string;
};

/** What an asset is used for; names its label in the UI language. */
export type AssetKind =
  'kitTile' | 'kitLeaves' | 'sky' | 'yardConcrete' | 'streetAsphalt' | 'pavers';

/** What a credited person did, where a source separates the roles; names its label in the UI language. */
export type CreditRole = 'processing' | 'photography' | 'original' | 'skyEdits';

export type CreditedPerson = {
  readonly name: string;
  readonly role?: CreditRole;
};

export type AssetCredit = {
  readonly kind: AssetKind;
  /** The upstream asset id, a proper name. */
  readonly asset: string;
  /** SPDX identifier. */
  readonly licence: string;
  readonly people: readonly CreditedPerson[];
  /** The site the asset comes from, a proper name. */
  readonly host: string;
  readonly page: string;
};

export type AboutCredits = {
  readonly app: LicenceText;
  readonly thirdParty: readonly ThirdParty[];
  readonly assets: readonly AssetCredit[];
};
