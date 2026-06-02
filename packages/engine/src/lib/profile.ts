import path from "node:path";
import { loadBrand, type Brand } from "./brand.js";

export interface Profile {
  /** Absolute path to the profile directory (e.g. examples/sai-voice). */
  profilePath: string;
  /** Validated brand config from <profilePath>/brand.yaml. */
  brand: Brand;
  /** Absolute path to the profile's external voice corpus dir. */
  voiceCorpusDir: string;
}

/**
 * Load a voice profile from a directory containing brand.yaml. The engine never
 * hardcodes a profile; callers pass the directory (from the --profile CLI arg).
 */
export function loadProfile(profileDir: string): Profile {
  const profilePath = path.resolve(profileDir);
  const brand = loadBrand(path.join(profilePath, "brand.yaml"));
  const voiceCorpusDir = path.join(profilePath, brand.sources.voice_corpus.dir);
  return { profilePath, brand, voiceCorpusDir };
}
