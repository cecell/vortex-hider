import { actions, types } from "vortex-api";
import { createAction } from "redux-act";

const STATE_PATH = ["settings", "hider"];

const MODS_TABLE_ID = "mods";
const MODS_CONTEXT_GROUP = "mods-action-icons";

const HIDER_ATTRIBUTE_ID = "hider-internal";
const HIDDEN_ROW_CLASS = "hider-hidden-row";

const STRUCTURAL_STYLE_ELEMENT_ID = "hider-structural-css";
const ROW_STYLE_ELEMENT_ID = "hider-row-css";

// Used only to clean up state left behind by the prototype category-based build.
// The current Hider implementation never uses categories for hiding.
const LEGACY_HIDDEN_CATEGORY_PREFIX = "__hider_profile__:";

const ARCHIVE_ID_PREFIX = "archive:";
const MOD_ID_PREFIX = "mod:";

interface IHiddenEntry {
  archiveId?: string;
  modId?: string;
}

interface IProfileHiddenState {
  gameId: string;
  hidden: {
    [identity: string]: IHiddenEntry;
  };
}

interface IHiderState {
  schemaVersion: number;
  enabled: boolean;
  profiles: {
    [profileId: string]: IProfileHiddenState;
  };
}

interface IResolvedInstalledMod {
  modId: string;
  mod: any;
}

const setHiderEnabled = createAction(
  "HIDER_SET_ENABLED",
  (enabled: boolean) => enabled,
);

const addHiddenEntry = createAction(
  "HIDER_ADD_HIDDEN_ENTRY",
  (
    profileId: string,
    gameId: string,
    identity: string,
    entry: IHiddenEntry,
  ) => ({
    profileId,
    gameId,
    identity,
    entry,
  }),
);

const removeHiddenEntry = createAction(
  "HIDER_REMOVE_HIDDEN_ENTRY",
  (profileId: string, identity: string) => ({
    profileId,
    identity,
  }),
);

const replaceProfileHidden = createAction(
  "HIDER_REPLACE_PROFILE_HIDDEN",
  (
    profileId: string,
    gameId: string,
    hidden: { [identity: string]: IHiddenEntry },
  ) => ({
    profileId,
    gameId,
    hidden,
  }),
);

const reducerImpl: types.IReducerSpec<IHiderState> = {
  reducers: {
    [setHiderEnabled as any]: (state, enabled: boolean) => ({
      ...state,
      schemaVersion: 2,
      enabled,
      profiles: state.profiles ?? {},
    }),

    [addHiddenEntry as any]: (state, payload) => {
      const {
        profileId,
        gameId,
        identity,
        entry,
      } = payload;

      const profiles = state.profiles ?? {};
      const existingProfile = profiles[profileId];

      return {
        ...state,
        schemaVersion: 2,
        profiles: {
          ...profiles,
          [profileId]: {
            gameId,
            hidden: {
              ...(existingProfile?.hidden ?? {}),
              [identity]: entry,
            },
          },
        },
      };
    },

    [removeHiddenEntry as any]: (state, payload) => {
      const { profileId, identity } = payload;
      const profiles = state.profiles ?? {};
      const existingProfile = profiles[profileId];

      if (existingProfile === undefined) {
        return state;
      }

      const hidden = {
        ...(existingProfile.hidden ?? {}),
      };

      delete hidden[identity];

      return {
        ...state,
        schemaVersion: 2,
        profiles: {
          ...profiles,
          [profileId]: {
            ...existingProfile,
            hidden,
          },
        },
      };
    },

    [replaceProfileHidden as any]: (state, payload) => {
      const {
        profileId,
        gameId,
        hidden,
      } = payload;

      return {
        ...state,
        schemaVersion: 2,
        profiles: {
          ...(state.profiles ?? {}),
          [profileId]: {
            gameId,
            hidden,
          },
        },
      };
    },
  },

  defaults: {
    schemaVersion: 2,
    enabled: true,
    profiles: {},
  },
};

const reducer = reducerImpl as unknown as types.IReducerSpec;

let showingHidden = false;
let suppressFilterWatch = false;
let refreshHiderRows: (() => void) | undefined;

/*
 * ---------------------------------------------------------------------------
 * State helpers
 * ---------------------------------------------------------------------------
 */

function hiderState(state: any): IHiderState {
  return state.settings?.hider ?? {
    schemaVersion: 2,
    enabled: true,
    profiles: {},
  };
}

function hiderEnabled(state: any): boolean {
  return hiderState(state).enabled !== false;
}

function activeProfileId(state: any): string | undefined {
  return state.settings?.profiles?.activeProfileId;
}

function profileById(
  state: any,
  profileId: string | undefined,
): any | undefined {
  if (profileId === undefined) {
    return undefined;
  }

  return state.persistent?.profiles?.[profileId];
}

function activeProfile(state: any): any | undefined {
  return profileById(state, activeProfileId(state));
}

function profileHiddenState(
  state: any,
  profileId: string,
): IProfileHiddenState | undefined {
  return hiderState(state).profiles?.[profileId];
}

function hiddenMap(
  state: any,
  profileId: string,
): { [identity: string]: IHiddenEntry } {
  return profileHiddenState(state, profileId)?.hidden ?? {};
}

function hiddenCount(
  state: any,
  profileId: string,
): number {
  return Object.keys(hiddenMap(state, profileId)).length;
}

function modsForGame(
  state: any,
  gameId: string,
): { [modId: string]: any } {
  return state.persistent?.mods?.[gameId] ?? {};
}

function downloads(
  state: any,
): { [downloadId: string]: any } {
  return state.persistent?.downloads?.files ?? {};
}

function normalizeId(value: any): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return String(value);
}

function archiveIdentity(archiveId: string): string {
  return `${ARCHIVE_ID_PREFIX}${archiveId}`;
}

function modIdentity(modId: string): string {
  return `${MOD_ID_PREFIX}${modId}`;
}

function isCanonicalIdentity(identity: string): boolean {
  return (
    identity.startsWith(ARCHIVE_ID_PREFIX) ||
    identity.startsWith(MOD_ID_PREFIX)
  );
}

function identityArchiveId(identity: string): string | undefined {
  if (!identity.startsWith(ARCHIVE_ID_PREFIX)) {
    return undefined;
  }

  return identity.slice(ARCHIVE_ID_PREFIX.length);
}

function identityModId(identity: string): string | undefined {
  if (!identity.startsWith(MOD_ID_PREFIX)) {
    return undefined;
  }

  return identity.slice(MOD_ID_PREFIX.length);
}

function installedModEnabled(
  profile: any,
  modId: string,
): boolean {
  return profile?.modState?.[modId]?.enabled === true;
}

/*
 * ---------------------------------------------------------------------------
 * Hidden identity
 * ---------------------------------------------------------------------------
 */

function entryForInstalledMod(
  modId: string,
  mod: any,
): {
  identity: string;
  entry: IHiddenEntry;
} {
  const archiveId = normalizeId(mod?.archiveId);

  if (archiveId !== undefined) {
    return {
      identity: archiveIdentity(archiveId),
      entry: {
        archiveId,
        modId,
      },
    };
  }

  return {
    identity: modIdentity(modId),
    entry: {
      modId,
    },
  };
}

function entryForDownloadedArchive(
  archiveId: string,
): {
  identity: string;
  entry: IHiddenEntry;
} {
  return {
    identity: archiveIdentity(archiveId),
    entry: {
      archiveId,
    },
  };
}

function entryForRow(
  row: any,
): {
  identity: string;
  entry: IHiddenEntry;
} | undefined {
  if (row === undefined || row === null) {
    return undefined;
  }

  const rowId = normalizeId(row.id);
  const archiveId = normalizeId(row.archiveId);

  if (archiveId !== undefined) {
    return {
      identity: archiveIdentity(archiveId),
      entry: {
        archiveId,
        modId: row.state === "downloaded"
          ? undefined
          : rowId,
      },
    };
  }

  if (rowId !== undefined) {
    return {
      identity: modIdentity(rowId),
      entry: {
        modId: rowId,
      },
    };
  }

  return undefined;
}

function storedEntryFromIdentity(
  identity: string,
  rawEntry: any,
): IHiddenEntry {
  const archiveId =
    normalizeId(rawEntry?.archiveId) ??
    identityArchiveId(identity);

  let modId =
    normalizeId(rawEntry?.modId) ??
    identityModId(identity);

  // Prototype builds stored the installed mod id directly as the key.
  if (!isCanonicalIdentity(identity) && modId === undefined) {
    modId = identity;
  }

  return {
    archiveId,
    modId,
  };
}

function resolveInstalledMod(
  mods: { [modId: string]: any },
  entry: IHiddenEntry,
): IResolvedInstalledMod | undefined {
  if (
    entry.modId !== undefined &&
    mods[entry.modId] !== undefined
  ) {
    return {
      modId: entry.modId,
      mod: mods[entry.modId],
    };
  }

  if (entry.archiveId !== undefined) {
    const modId = Object.keys(mods).find((candidateModId) => {
      return (
        normalizeId(mods[candidateModId]?.archiveId) ===
        entry.archiveId
      );
    });

    if (modId !== undefined) {
      return {
        modId,
        mod: mods[modId],
      };
    }
  }

  return undefined;
}

function hiddenIdentityForRow(
  state: any,
  profileId: string,
  row: any,
): string | undefined {
  const profileHidden = hiddenMap(state, profileId);
  const rowEntry = entryForRow(row);

  if (rowEntry === undefined) {
    return undefined;
  }

  if (profileHidden[rowEntry.identity] !== undefined) {
    return rowEntry.identity;
  }

  const rowArchiveId = rowEntry.entry.archiveId;
  const rowModId = rowEntry.entry.modId;

  return Object.keys(profileHidden).find((identity) => {
    const entry = storedEntryFromIdentity(
      identity,
      profileHidden[identity],
    );

    if (
      rowArchiveId !== undefined &&
      entry.archiveId === rowArchiveId
    ) {
      return true;
    }

    if (
      rowModId !== undefined &&
      entry.modId === rowModId
    ) {
      return true;
    }

    return false;
  });
}

function rowIsHidden(
  api: types.IExtensionApi,
  row: any,
): boolean {
  if (row === undefined || row?.id === undefined) {
    return false;
  }

  const state = api.getState();
  const profileId = activeProfileId(state);

  if (profileId === undefined) {
    return false;
  }

  return (
    hiddenIdentityForRow(
      state,
      profileId,
      row,
    ) !== undefined
  );
}

/*
 * ---------------------------------------------------------------------------
 * Runtime CSS
 * ---------------------------------------------------------------------------
 */

function installStructuralCSS(): void {
  if (
    document.getElementById(STRUCTURAL_STYLE_ELEMENT_ID) !== null
  ) {
    return;
  }

  const style = document.createElement("style");
  style.id = STRUCTURAL_STYLE_ELEMENT_ID;

  style.textContent = `
#table-mods .header-${HIDER_ATTRIBUTE_ID},
#table-mods .cell-${HIDER_ATTRIBUTE_ID} {
  display: none !important;
}
`;

  document.head.appendChild(style);
}

function installRowCSS(): void {
  if (
    document.getElementById(ROW_STYLE_ELEMENT_ID) !== null
  ) {
    return;
  }

  const style = document.createElement("style");
  style.id = ROW_STYLE_ELEMENT_ID;

  style.textContent = `
#table-mods tr.${HIDDEN_ROW_CLASS} {
  display: none !important;
}
`;

  document.head.appendChild(style);
}

function removeRowCSS(): void {
  document
    .getElementById(ROW_STYLE_ELEMENT_ID)
    ?.remove();
}

function syncRowCSS(
  api: types.IExtensionApi,
): void {
  const state = api.getState();

  if (
    hiderEnabled(state) &&
    !showingHidden
  ) {
    installRowCSS();
  } else {
    removeRowCSS();
  }
}

function requestRowRefresh(): void {
  refreshHiderRows?.();
}

/*
 * ---------------------------------------------------------------------------
 * Hider filter / Show Hidden mode
 * ---------------------------------------------------------------------------
 */

function currentHiderFilter(
  state: any,
): any {
  return state.settings
    ?.tables
    ?.mods
    ?.filter
    ?.[HIDER_ATTRIBUTE_ID];
}

function clearHiderFilter(
  api: types.IExtensionApi,
): void {
  const state = api.getState();

  if (currentHiderFilter(state) === undefined) {
    return;
  }

  suppressFilterWatch = true;

  try {
    api.store!.dispatch(
      actions.setAttributeFilter(
        MODS_TABLE_ID,
        HIDER_ATTRIBUTE_ID,
        null,
      ),
    );
  } finally {
    suppressFilterWatch = false;
  }
}

function refreshHiddenFilter(
  api: types.IExtensionApi,
): void {
  if (!showingHidden) {
    return;
  }

  suppressFilterWatch = true;

  try {
    // Re-dispatching the same filter deliberately produces a new
    // Vortex table-filter state object and forces filteredRows() to
    // run again against the current Hider state.
    api.store!.dispatch(
      actions.setAttributeFilter(
        MODS_TABLE_ID,
        HIDER_ATTRIBUTE_ID,
        true,
      ),
    );
  } finally {
    suppressFilterWatch = false;
  }
}

function leaveHiddenView(
  api: types.IExtensionApi,
): void {
  showingHidden = false;
  clearHiderFilter(api);
  requestRowRefresh();
  syncRowCSS(api);
}

function finishHiddenMutation(
  api: types.IExtensionApi,
): void {
  requestRowRefresh();

  if (showingHidden) {
    const state = api.getState();
    const profileId = activeProfileId(state);

    if (
      profileId === undefined ||
      hiddenCount(state, profileId) === 0
    ) {
      leaveHiddenView(api);
      return;
    }

    refreshHiddenFilter(api);
  }

  syncRowCSS(api);
}

function showHiddenMods(
  api: types.IExtensionApi,
): void {
  const state = api.getState();
  const profileId = activeProfileId(state);

  if (
    profileId === undefined ||
    !hiderEnabled(state) ||
    hiddenCount(state, profileId) === 0
  ) {
    return;
  }

  showingHidden = true;
  removeRowCSS();

  suppressFilterWatch = true;

  try {
    // Show Hidden deliberately starts with a clean filter state.
    api.store!.dispatch(
      actions.setAttributeFilter(
        MODS_TABLE_ID,
        undefined as any,
        null,
      ),
    );

    api.store!.dispatch(
      actions.setAttributeFilter(
        MODS_TABLE_ID,
        HIDER_ATTRIBUTE_ID,
        true,
      ),
    );
  } finally {
    suppressFilterWatch = false;
  }
}

function hideHiddenMods(
  api: types.IExtensionApi,
): void {
  showingHidden = false;

  suppressFilterWatch = true;

  try {
    /*
     * Match Vortex's "Clear all filters" behavior rather than
     * clearing only Hider's internal filter.
     */
    api.store!.dispatch(
      actions.setAttributeFilter(
        MODS_TABLE_ID,
        undefined as any,
        null,
      ),
    );
  } finally {
    suppressFilterWatch = false;
  }

  requestRowRefresh();
  syncRowCSS(api);
}

/*
 * ---------------------------------------------------------------------------
 * Prototype category cleanup
 * ---------------------------------------------------------------------------
 */

function cleanupLegacyCategoryForActiveProfile(
  api: types.IExtensionApi,
  profile: any,
): void {
  const state = api.getState();

  const categoryId =
    `${LEGACY_HIDDEN_CATEGORY_PREFIX}${profile.id}`;

  const category =
    state.persistent
      ?.categories
      ?.[profile.gameId]
      ?.[categoryId];

  if (category === undefined) {
    return;
  }

  const mods = modsForGame(
    state,
    profile.gameId,
  );

  const storedHidden =
    profileHiddenState(
      state,
      profile.id,
    )?.hidden ?? {};

  let safeToRemoveCategory = true;

  Object.keys(mods).forEach((modId) => {
    const mod = mods[modId];

    if (
      normalizeId(mod?.attributes?.category) !==
      categoryId
    ) {
      return;
    }

    const legacyEntry: any =
      (storedHidden as any)[modId];

    if (
      legacyEntry !== undefined &&
      Object.prototype.hasOwnProperty.call(
        legacyEntry,
        "originalCategory",
      )
    ) {
      // This is the one and only place the new build writes a
      // category: it reverses the prototype build's old write.
      api.store!.dispatch(
        actions.setModAttribute(
          profile.gameId,
          modId,
          "category",
          legacyEntry.originalCategory,
        ),
      );
    } else {
      // Don't delete a category while something still references it
      // unless we know exactly what category should be restored.
      safeToRemoveCategory = false;
    }
  });

  if (safeToRemoveCategory) {
    api.store!.dispatch(
      actions.removeCategory(
        profile.gameId,
        categoryId,
      ),
    );
  }
}

/*
 * ---------------------------------------------------------------------------
 * Active-profile reconciliation
 * ---------------------------------------------------------------------------
 */

function hiddenMapsEqual(
  lhs: { [identity: string]: IHiddenEntry },
  rhs: { [identity: string]: IHiddenEntry },
): boolean {
  const lhsKeys = Object.keys(lhs).sort();
  const rhsKeys = Object.keys(rhs).sort();

  if (lhsKeys.length !== rhsKeys.length) {
    return false;
  }

  for (let idx = 0; idx < lhsKeys.length; idx++) {
    if (lhsKeys[idx] !== rhsKeys[idx]) {
      return false;
    }

    const left = lhs[lhsKeys[idx]];
    const right = rhs[rhsKeys[idx]];

    if (
      left?.archiveId !== right?.archiveId ||
      left?.modId !== right?.modId
    ) {
      return false;
    }
  }

  return true;
}

function reconcileActiveProfile(
  api: types.IExtensionApi,
  requestedProfileId?: string,
): void {
  let state = api.getState();
  const activeId = activeProfileId(state);

  if (
    activeId === undefined ||
    (
      requestedProfileId !== undefined &&
      requestedProfileId !== activeId
    )
  ) {
    return;
  }

  const profile = profileById(
    state,
    activeId,
  );

  if (profile === undefined) {
    return;
  }

  // Undo category changes made by the prototype build, but ONLY
  // for the profile currently being activated.
  cleanupLegacyCategoryForActiveProfile(
    api,
    profile,
  );

  // Category cleanup may have changed Vortex state.
  state = api.getState();

  const storedProfileState =
    profileHiddenState(
      state,
      activeId,
    );

  if (storedProfileState === undefined) {
    return;
  }

  const storedHidden: {
    [identity: string]: any;
  } = storedProfileState.hidden ?? {};

  const mods = modsForGame(
    state,
    profile.gameId,
  );

  const archiveDownloads = downloads(state);

  const reconciled: {
    [identity: string]: IHiddenEntry;
  } = {};

  Object.keys(storedHidden).forEach(
    (storedIdentity) => {
      const entry = storedEntryFromIdentity(
        storedIdentity,
        storedHidden[storedIdentity],
      );

      let installed = resolveInstalledMod(
        mods,
        entry,
      );

      /*
       * Legacy prototype entries used the raw installed mod id
       * as their key. If that mod still exists, resolve it here.
       */
      if (
        installed === undefined &&
        !isCanonicalIdentity(storedIdentity) &&
        mods[storedIdentity] !== undefined
      ) {
        installed = {
          modId: storedIdentity,
          mod: mods[storedIdentity],
        };
      }

      if (installed !== undefined) {
        /*
         * Enabling a mod is authoritative.
         *
         * If this installed mod is enabled in THIS active profile,
         * it must no longer be hidden in THIS active profile.
         */
        if (
          installedModEnabled(
            profile,
            installed.modId,
          )
        ) {
          return;
        }

        const canonical =
          entryForInstalledMod(
            installed.modId,
            installed.mod,
          );

        reconciled[canonical.identity] = {
          ...canonical.entry,
        };

        return;
      }

      /*
       * No installed mod resolved.
       *
       * If the archive still exists, this is an uninstalled mod
       * whose hidden designation must survive.
       */
      if (
        entry.archiveId !== undefined &&
        archiveDownloads[entry.archiveId] !== undefined
      ) {
        const canonical =
          entryForDownloadedArchive(
            entry.archiveId,
          );

        reconciled[canonical.identity] = {
          ...canonical.entry,
          modId: entry.modId,
        };

        return;
      }

      /*
       * Neither an installed mod nor its archive exists.
       * This entry is stale and is intentionally discarded.
       */
    },
  );

  const normalizedCurrent: {
    [identity: string]: IHiddenEntry;
  } = {};

  Object.keys(storedHidden).forEach((identity) => {
    normalizedCurrent[identity] =
      storedEntryFromIdentity(
        identity,
        storedHidden[identity],
      );
  });

  if (
    storedProfileState.gameId !== profile.gameId ||
    !hiddenMapsEqual(
      normalizedCurrent,
      reconciled,
    ) ||
    hiderState(state).schemaVersion !== 2
  ) {
    api.store!.dispatch(
      replaceProfileHidden(
        activeId,
        profile.gameId,
        reconciled,
      ),
    );
  }
}

/*
 * ---------------------------------------------------------------------------
 * Hide / Unhide
 * ---------------------------------------------------------------------------
 */

function idsFromAction(
  instanceIds?: string | string[],
): string[] {
  if (instanceIds === undefined) {
    return [];
  }

  if (Array.isArray(instanceIds)) {
    return instanceIds;
  }

  return [instanceIds];
}

function installedModForRowId(
  state: any,
  gameId: string,
  rowId: string,
): any | undefined {
  return modsForGame(
    state,
    gameId,
  )[rowId];
}

function finishedDownloadForRowId(
  state: any,
  rowId: string,
): any | undefined {
  const download = downloads(state)[rowId];

  if (
    download === undefined ||
    download.state !== "finished"
  ) {
    return undefined;
  }

  return download;
}

function rowForActionId(
  state: any,
  profile: any,
  rowId: string,
): any | undefined {
  const installed = installedModForRowId(
    state,
    profile.gameId,
    rowId,
  );

  if (installed !== undefined) {
    return {
      ...installed,
      id: installed.id ?? rowId,
      state: "installed",
      enabled:
        installedModEnabled(
          profile,
          rowId,
        ),
    };
  }

  const download = finishedDownloadForRowId(
    state,
    rowId,
  );

  if (download !== undefined) {
    return {
      id: rowId,
      archiveId: rowId,
      state: "downloaded",
      enabled: null,
    };
  }

  return undefined;
}

function hideForProfile(
  api: types.IExtensionApi,
  rowIds: string[],
): void {
  const state = api.getState();
  const profileId = activeProfileId(state);
  const profile = activeProfile(state);

  if (
    profileId === undefined ||
    profile === undefined
  ) {
    return;
  }

  rowIds.forEach((rowId) => {
    const row = rowForActionId(
      api.getState(),
      profile,
      rowId,
    );

    if (row === undefined) {
      return;
    }

    /*
     * Installed + enabled is never hideable.
     * Downloaded/uninstalled has no enabled state and is hideable.
     */
    if (
      row.state !== "downloaded" &&
      installedModEnabled(
        profile,
        rowId,
      )
    ) {
      return;
    }

    const rowEntry = entryForRow(row);

    if (rowEntry === undefined) {
      return;
    }

    if (
      hiddenIdentityForRow(
        api.getState(),
        profileId,
        row,
      ) !== undefined
    ) {
      return;
    }

    api.store!.dispatch(
      addHiddenEntry(
        profileId,
        profile.gameId,
        rowEntry.identity,
        rowEntry.entry,
      ),
    );
  });

  finishHiddenMutation(api);
}

function unhideForProfile(
  api: types.IExtensionApi,
  rowIds: string[],
): void {
  const state = api.getState();
  const profileId = activeProfileId(state);
  const profile = activeProfile(state);

  if (
    profileId === undefined ||
    profile === undefined
  ) {
    return;
  }

  rowIds.forEach((rowId) => {
    const row = rowForActionId(
      api.getState(),
      profile,
      rowId,
    );

    if (row === undefined) {
      return;
    }

    const identity = hiddenIdentityForRow(
      api.getState(),
      profileId,
      row,
    );

    if (identity === undefined) {
      return;
    }

    api.store!.dispatch(
      removeHiddenEntry(
        profileId,
        identity,
      ),
    );
  });

  finishHiddenMutation(api);
}

/*
 * ---------------------------------------------------------------------------
 * Automatic unhide on Enable
 * ---------------------------------------------------------------------------
 */

function removeHiddenForEnabledMod(
  api: types.IExtensionApi,
  profileId: string,
  modId: string,
): boolean {
  const state = api.getState();

  if (activeProfileId(state) !== profileId) {
    return false;
  }

  const profile = profileById(
    state,
    profileId,
  );

  if (profile === undefined) {
    return false;
  }

  /*
   * Never modify the hidden state merely because another profile
   * enabled the same globally installed mod.
   */
  if (
    !installedModEnabled(
      profile,
      modId,
    )
  ) {
    return false;
  }

  const mod = modsForGame(
    state,
    profile.gameId,
  )[modId];

  if (mod === undefined) {
    return false;
  }

  const row = {
    ...mod,
    id: mod.id ?? modId,
    state: "installed",
    enabled: true,
  };

  const identity = hiddenIdentityForRow(
    state,
    profileId,
    row,
  );

  if (identity === undefined) {
    return false;
  }

  api.store!.dispatch(
    removeHiddenEntry(
      profileId,
      identity,
    ),
  );

  return true;
}

function onModsEnabled(
  api: types.IExtensionApi,
  modIds: string[],
  enabled: boolean,
  gameId: string,
): void {
  if (!enabled) {
    return;
  }

  const state = api.getState();
  const profileId = activeProfileId(state);
  const profile = activeProfile(state);

  if (
    profileId === undefined ||
    profile === undefined ||
    profile.gameId !== gameId
  ) {
    return;
  }

  let changed = false;

  modIds.forEach((modId) => {
    changed =
      removeHiddenForEnabledMod(
        api,
        profileId,
        modId,
      ) || changed;
  });

  if (changed) {
    finishHiddenMutation(api);
  }
}

/*
 * ---------------------------------------------------------------------------
 * Conditions
 * ---------------------------------------------------------------------------
 */

function canHide(
  api: types.IExtensionApi,
  instanceIds: string | string[],
): boolean | string {
  const state = api.getState();

  if (!hiderEnabled(state)) {
    return false;
  }

  const profileId = activeProfileId(state);
  const profile = activeProfile(state);

  if (
    profileId === undefined ||
    profile === undefined
  ) {
    return false;
  }

  const rowIds = idsFromAction(instanceIds);

  if (rowIds.length === 0) {
    return false;
  }

  for (const rowId of rowIds) {
    const row = rowForActionId(
      state,
      profile,
      rowId,
    );

    if (row === undefined) {
      return false;
    }

    if (
      hiddenIdentityForRow(
        state,
        profileId,
        row,
      ) !== undefined
    ) {
      return false;
    }

    if (
      row.state !== "downloaded" &&
      installedModEnabled(
        profile,
        rowId,
      )
    ) {
      return "Enabled mods cannot be hidden for a profile.";
    }
  }

  return true;
}

function canUnhide(
  api: types.IExtensionApi,
  instanceIds: string | string[],
): boolean {
  const state = api.getState();

  if (!hiderEnabled(state)) {
    return false;
  }

  const profileId = activeProfileId(state);
  const profile = activeProfile(state);

  if (
    profileId === undefined ||
    profile === undefined
  ) {
    return false;
  }

  return idsFromAction(instanceIds).some((rowId) => {
    const row = rowForActionId(
      state,
      profile,
      rowId,
    );

    if (row === undefined) {
      return false;
    }

    return (
      hiddenIdentityForRow(
        state,
        profileId,
        row,
      ) !== undefined
    );
  });
}

function canShowHidden(
  api: types.IExtensionApi,
): boolean {
  const state = api.getState();
  const profileId = activeProfileId(state);

  return (
    hiderEnabled(state) &&
    !showingHidden &&
    profileId !== undefined &&
    hiddenCount(state, profileId) > 0
  );
}

function canHideHidden(
  api: types.IExtensionApi,
): boolean {
  return (
    hiderEnabled(api.getState()) &&
    showingHidden
  );
}

/*
 * ---------------------------------------------------------------------------
 * Enable / Disable Hider
 * ---------------------------------------------------------------------------
 */

function disableHider(
  api: types.IExtensionApi,
): void {
  api.store!.dispatch(
    setHiderEnabled(false),
  );

  showingHidden = false;
  clearHiderFilter(api);
  removeRowCSS();
  requestRowRefresh();
}

function enableHider(
  api: types.IExtensionApi,
): void {
  api.store!.dispatch(
    setHiderEnabled(true),
  );

  showingHidden = false;
  clearHiderFilter(api);
  requestRowRefresh();
  syncRowCSS(api);
}

/*
 * ---------------------------------------------------------------------------
 * Extension bootstrap
 * ---------------------------------------------------------------------------
 */

function init(
  context: types.IExtensionContext,
): boolean {
  context.registerReducer(
    STATE_PATH,
    reducer,
  );

  /*
   * This attribute is deliberately logically enabled so Vortex's
   * table filtering engine can use it.
   *
   * Its actual column is permanently concealed by structural CSS.
   */
  context.registerTableAttribute(
    MODS_TABLE_ID,
    {
      id: HIDER_ATTRIBUTE_ID,
      name: "Hider",
      description:
        "Internal profile-specific Hider state",

      placement: "table",

      isDefaultVisible: true,
      isToggleable: false,
      isSortable: false,
      isGroupable: false,

      filter: {
        raw: true,
        dataId: "$",

        component: (() => null) as any,

        matches: (
          filter: any,
          row: any,
        ): boolean => {
          if (filter !== true) {
            return true;
          }

          return rowIsHidden(
            context.api,
            row,
          );
        },

        isEmpty: (filter: any): boolean =>
          filter !== true,
      },

      calc: (row: any) =>
        rowIsHidden(
          context.api,
          row,
        ),

      cssClass: (row: any) =>
        rowIsHidden(
          context.api,
          row,
        )
          ? HIDDEN_ROW_CLASS
          : "",

      externalData: (
        onChanged: () => void,
      ) => {
        refreshHiderRows = onChanged;
      },

      edit: {},
    } as any,
  );

  context.registerAction(
    MODS_CONTEXT_GROUP,
    2,
    "show",
    {},
    "Hide for profile",
    (instanceIds?: string[]) => {
      hideForProfile(
        context.api,
        idsFromAction(instanceIds),
      );
    },
    (instanceIds?: string[]) =>
      canHide(
        context.api,
        instanceIds ?? [],
      ),
  );

  context.registerAction(
    MODS_CONTEXT_GROUP,
    2,
    "show",
    {},
    "Unhide for profile",
    (instanceIds?: string[]) => {
      unhideForProfile(
        context.api,
        idsFromAction(instanceIds),
      );
    },
    (instanceIds?: string[]) =>
      canUnhide(
        context.api,
        instanceIds ?? [],
      ),
  );

  context.registerAction(
    MODS_CONTEXT_GROUP,
    20,
    "show",
    {},
    "Show hidden mods",
    () => {
      showHiddenMods(
        context.api,
      );
    },
    () =>
      canShowHidden(
        context.api,
      ),
  );

  context.registerAction(
    MODS_CONTEXT_GROUP,
    20,
    "show",
    {},
    "Hide hidden mods",
    () => {
      hideHiddenMods(
        context.api,
      );
    },
    () =>
      canHideHidden(
        context.api,
      ),
  );

  context.registerAction(
    MODS_CONTEXT_GROUP,
    90,
    "settings",
    {},
    "Disable Hider",
    () => {
      disableHider(
        context.api,
      );
    },
    () =>
      hiderEnabled(
        context.api.getState(),
      ),
  );

  context.registerAction(
    MODS_CONTEXT_GROUP,
    90,
    "settings",
    {},
    "Enable Hider",
    () => {
      enableHider(
        context.api,
      );
    },
    () =>
      !hiderEnabled(
        context.api.getState(),
      ),
  );

  context.once(() => {
    installStructuralCSS();

    /*
     * The prototype registered this same attribute as invisible.
     * Force it logically enabled in case Vortex persisted that old
     * visibility state.
     *
     * Structural CSS still prevents the column from appearing.
     */
    context.api.store!.dispatch(
      actions.setAttributeVisible(
        MODS_TABLE_ID,
        HIDER_ATTRIBUTE_ID,
        true,
      ),
    );

    reconcileActiveProfile(
      context.api,
    );

    requestRowRefresh();
    syncRowCSS(
      context.api,
    );

    /*
     * Profile activation is the full integrity pass.
     *
     * ONLY the newly active profile's Hider state is reconciled.
     * No other profile is read, rewritten or cleaned.
     */
    (context.api.events as any).on(
      "profile-did-change",
      (profileId: string) => {
        showingHidden = false;
        clearHiderFilter(
          context.api,
        );

        reconcileActiveProfile(
          context.api,
          profileId,
        );

        requestRowRefresh();
        syncRowCSS(
          context.api,
        );
      },
    );

    /*
     * This is Vortex's primary multi-mod enabled-state event.
     * Disabling does nothing.
     * Enabling automatically removes the hidden designation.
     */
    (context.api.events as any).on(
      "mods-enabled",
      (
        modIds: string[],
        enabled: boolean,
        gameId: string,
      ) => {
        onModsEnabled(
          context.api,
          modIds,
          enabled,
          gameId,
        );
      },
    );

    /*
     * Keep support for the documented singular event too.
     */
    (context.api.events as any).on(
      "mod-enabled",
      (
        profileId: string,
        modId: string,
      ) => {
        if (
          removeHiddenForEnabledMod(
            context.api,
            profileId,
            modId,
          )
        ) {
          finishHiddenMutation(
            context.api,
          );
        }
      },
    );

    /*
     * Installing alone must NOT unhide.
     *
     * The archive-first identity automatically carries over from
     * the downloaded row to the installed row. We only need the
     * table to recalculate its row class.
     */
    (context.api.events as any).on(
      "did-install-mod",
      (
        gameId: string,
        _archiveId: string,
        _modId: string,
      ) => {
        const profile =
          activeProfile(
            context.api.getState(),
          );

        if (
          profile?.gameId !== gameId
        ) {
          return;
        }

        requestRowRefresh();

        if (showingHidden) {
          refreshHiddenFilter(
            context.api,
          );
        }
      },
    );

    /*
     * Uninstalling does NOT directly remove a hidden designation.
     *
     * Reconciliation keeps archive identities when the archive
     * remains and removes only truly stale identities.
     */
    (context.api.events as any).on(
      "did-remove-mod",
      (
        gameId: string,
        _modId: string,
      ) => {
        const profile =
          activeProfile(
            context.api.getState(),
          );

        if (
          profile?.gameId !== gameId
        ) {
          return;
        }

        reconcileActiveProfile(
          context.api,
        );

        finishHiddenMutation(
          context.api,
        );
      },
    );

    (context.api.events as any).on(
      "did-remove-mods",
      (
        gameId: string,
        _removedMods: any[],
      ) => {
        const profile =
          activeProfile(
            context.api.getState(),
          );

        if (
          profile?.gameId !== gameId
        ) {
          return;
        }

        reconcileActiveProfile(
          context.api,
        );

        finishHiddenMutation(
          context.api,
        );
      },
    );

    /*
     * Clearing Hider's internal filter exits Show Hidden.
     *
     * Other filters may be added while Show Hidden is active;
     * as long as hider-internal=true remains, Show Hidden remains
     * active.
     */
    context.api.onStateChange!(
      [
        "settings",
        "tables",
        MODS_TABLE_ID,
        "filter",
      ],
      (
        _previous: any,
        current: any,
      ) => {
        if (
          suppressFilterWatch ||
          !showingHidden
        ) {
          return;
        }

        if (
          current?.[HIDER_ATTRIBUTE_ID] === true
        ) {
          return;
        }

        showingHidden = false;
        requestRowRefresh();
        syncRowCSS(
          context.api,
        );
      },
    );
  });

  return true;
}

export default init;