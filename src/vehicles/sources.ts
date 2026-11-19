import type { Param } from '../contracts/vehicle';

export const SOURCES = {
  A: 'https://defence.mercedes-benz-trucks.com/fileadmin/Defence/Downloads/D_Technische-Daten_Arocs_ENG_screen.pdf',
  B: 'https://mbpassion.de/2017/04/thw-uebernimmt-41-mercedes-benz-arocs-allradkipper/',
  D: 'https://www.codeready.org/trucks/man-trucks/man-le-18-280-off-road-truck',
  K: 'https://www.krone-trailer.com/fileadmin/media/downloads/DE/Wechselsysteme/Datenblaetter/Box_Carrier/AZW_18_eL3B9_DE.pdf',
  H: 'https://www.thw-hamburg-nord.de/kfz/90793.htm',
} as const;

export const sourced = (value: number, src: (typeof SOURCES)[keyof typeof SOURCES]): Param => ({
  value,
  status: 'sourced',
  source: src,
});

export const estimate = (value: number, basis: string): Param => ({
  value,
  status: 'estimate',
  source: basis,
});
