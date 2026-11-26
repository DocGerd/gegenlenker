export type LicenceText = {
  readonly name: string;
  /** SPDX identifier. */
  readonly spdx: string;
  readonly text: string;
};

export type ThirdParty = LicenceText & {
  /** Runtime dependencies this licence covers; empty when the code is not an npm package. */
  readonly covers: readonly string[];
  /** The file in `public/licenses/`. */
  readonly file: string;
};

export type AssetCredit = {
  readonly title: string;
  /** SPDX identifier. */
  readonly licence: string;
  readonly authors: string;
  readonly page: string;
};

export type AboutCredits = {
  readonly app: LicenceText;
  readonly thirdParty: readonly ThirdParty[];
  readonly assets: readonly AssetCredit[];
};
