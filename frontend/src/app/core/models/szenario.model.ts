import { ProzessKey } from './prozess-defaults';

export interface ProzessDauer {
  works: number[];
  waits: number[];
  /** Step names, one per work step, in step order. Optional: absent on a scenario
   *  saved before REQ-302 shipped, and on a malformed/legacy load the loader falls
   *  back to the example names — see rechner.component.ts's rebuildProzessArray(). */
  names?: string[];
}

export interface Szenario {
  id: number;
  name: string;
  humanSteps: ProzessDauer;
  agileKiSteps: ProzessDauer;
  semiAutomatedSteps: ProzessDauer;
  automatedSteps: ProzessDauer;
  createdAt: string;
  updatedAt: string;
}

export interface SzenarioCreate {
  name: string;
  humanSteps: ProzessDauer;
  agileKiSteps: ProzessDauer;
  semiAutomatedSteps: ProzessDauer;
  automatedSteps: ProzessDauer;
}

export type SzenarioUpdate = SzenarioCreate;

/** The Szenario field name that stores a given process's step durations. */
export type SzenarioProzessFeld =
  | 'humanSteps'
  | 'agileKiSteps'
  | 'semiAutomatedSteps'
  | 'automatedSteps';

/** Bridges the component's ProzessKey to the Szenario/SzenarioCreate field that stores it. */
export const PROZESS_SZENARIO_FELD: Record<ProzessKey, SzenarioProzessFeld> = {
  menschlich: 'humanSteps',
  agileKi: 'agileKiSteps',
  halbautomatisch: 'semiAutomatedSteps',
  vollautomatisch: 'automatedSteps',
};
