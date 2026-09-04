import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

export const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export function unwrap(result, label = "database") {
  if (result.error) {
    console.error(label, result.error);
    throw new Error(result.error.message || `Database error: ${label}`);
  }
  return result.data;
}

export async function charactersFor(userId) {
  return unwrap(await db.from("characters")
    .select("*")
    .eq("owner_discord_id", userId)
    .order("created_at"), "charactersFor");
}

export async function characterById(id) {
  const rows = unwrap(await db.from("characters").select("*").eq("id", id).limit(1), "characterById");
  return rows?.[0] ?? null;
}

export async function activeCharacter(userId, guildId) {
  const rows = unwrap(await db.from("guild_character_state")
    .select("active_character_id")
    .eq("discord_user_id", userId)
    .eq("guild_id", guildId)
    .limit(1), "activeCharacter");
  const id = rows?.[0]?.active_character_id;
  return id ? characterById(id) : null;
}

export async function setActiveCharacter(userId, guildId, characterId) {
  return unwrap(await db.from("guild_character_state").upsert({
    discord_user_id: userId,
    guild_id: guildId,
    active_character_id: characterId,
    updated_at: new Date().toISOString()
  }, { onConflict: "guild_id,discord_user_id" }), "setActiveCharacter");
}

export async function accountFor(characterId, accountType = "checking") {
  const rows = unwrap(await db.from("bank_accounts")
    .select("*")
    .eq("character_id", characterId)
    .eq("account_type", accountType)
    .eq("status", "active")
    .limit(1), "accountFor");
  return rows?.[0] ?? null;
}

export async function requireChecking(characterId) {
  const account = await accountFor(characterId, "checking");
  if (!account) throw new Error("This character needs an Equity Financial Checking account first.");
  return account;
}

export async function ensureOwnedCharacter(characterId, discordUserId) {
  const c = await characterById(characterId);
  if (!c || c.owner_discord_id !== discordUserId) {
    throw new Error("That character does not belong to you.");
  }
  return c;
}
