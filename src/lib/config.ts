/**
 * @fileoverview Configuration management for the Tarout CLI.
 * Stores user profiles, authentication tokens, and settings in ~/.tarout/config.json
 * @module lib/config
 */

import Conf from "conf";

/**
 * User profile containing authentication and context information.
 * @interface Profile
 */
export interface Profile {
  token: string;
  apiUrl: string;
  organizationId: string;
  organizationName: string;
  environmentId: string;
  environmentName: string;
  userId: string;
  userEmail: string;
  userName?: string;
}

/**
 * Root configuration structure containing all user profiles.
 * @interface Config
 */
export interface Config {
  /** Name of the currently active profile */
  currentProfile: string;
  /** Map of profile names to profile data */
  profiles: Record<string, Profile>;
}

/** Configuration store using the Conf library. Persists to ~/.tarout/config.json */
const config = new Conf<Config>({
  projectName: "tarout",
  defaults: {
    currentProfile: "default",
    profiles: {},
  },
});

/**
 * Gets the entire configuration object.
 * @returns {Config} The full configuration
 */
export function getConfig(): Config {
  return config.store;
}

/**
 * Gets the currently active profile.
 * @returns {Profile | null} The current profile or null if not logged in
 */
export function getCurrentProfile(): Profile | null {
  const cfg = getConfig();
  return cfg.profiles[cfg.currentProfile] || null;
}

/**
 * Saves a profile to the configuration.
 * @param {string} name - The profile name (e.g., "default", "work")
 * @param {Profile} profile - The profile data to save
 */
export function setProfile(name: string, profile: Profile): void {
  config.set(`profiles.${name}`, profile);
}

/**
 * Sets the currently active profile by name.
 * @param {string} name - The profile name to activate
 */
export function setCurrentProfile(name: string): void {
  config.set("currentProfile", name);
}

/**
 * Deletes a profile from the configuration.
 * @param {string} name - The profile name to delete
 */
export function deleteProfile(name: string): void {
  const profiles = config.get("profiles");
  delete profiles[name];
  config.set("profiles", profiles);
}

/**
 * Clears all configuration data, effectively logging out all profiles.
 */
export function clearConfig(): void {
  config.clear();
}

/**
 * Checks if the user is logged in (has a valid token).
 * @returns {boolean} True if logged in, false otherwise
 */
export function isLoggedIn(): boolean {
  const profile = getCurrentProfile();
  return profile !== null && !!profile.token;
}

/**
 * Gets the authentication token for the current profile.
 * @returns {string | null} The token or null if not logged in
 */
export function getToken(): string | null {
  const profile = getCurrentProfile();
  return profile?.token || null;
}

/**
 * Gets the API URL for the current profile.
 * @returns {string} The API URL, defaults to https://app.tarout.sa
 */
export function getApiUrl(): string {
  const profile = getCurrentProfile();
  return profile?.apiUrl || "https://app.tarout.sa";
}

/**
 * Updates the current profile with partial data.
 * @param {Partial<Profile>} updates - The fields to update
 */
export function updateProfile(updates: Partial<Profile>): void {
  const cfg = getConfig();
  const currentProfileName = cfg.currentProfile;
  const currentProfile = cfg.profiles[currentProfileName];

  if (currentProfile) {
    config.set(`profiles.${currentProfileName}`, {
      ...currentProfile,
      ...updates,
    });
  }
}

/**
 * Lists all available profile names.
 * @returns {string[]} Array of profile names
 */
export function listProfiles(): string[] {
  return Object.keys(config.get("profiles"));
}
