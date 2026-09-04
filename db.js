import { createClient } from "@supabase/supabase-js";
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase env vars");
export const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
export function unwrap(r,ctx="Supabase"){ if(r.error){console.error(ctx,r.error); throw new Error(r.error.message);} return r.data; }
export async function characters(userId){ return unwrap(await db.from("characters").select("*").eq("owner_discord_id",userId).order("created_at"),"characters"); }
export async function character(id){ return unwrap(await db.from("characters").select("*").eq("id",id).limit(1),"character")?.[0]||null; }
export async function activeCharacter(userId,guildId){
  const s=unwrap(await db.from("guild_character_state").select("active_character_id").eq("discord_user_id",userId).eq("guild_id",guildId).limit(1),"active state")?.[0];
  return s?.active_character_id ? character(s.active_character_id) : null;
}
export async function setActive(userId,guildId,characterId){
  unwrap(await db.from("guild_character_state").upsert({discord_user_id:userId,guild_id:guildId,active_character_id:characterId,updated_at:new Date().toISOString()},{onConflict:"guild_id,discord_user_id"}),"set active");
}
export async function account(characterId,type="checking"){
  return unwrap(await db.from("bank_accounts").select("*").eq("character_id",characterId).eq("account_type",type).eq("status","active").limit(1),"account")?.[0]||null;
}
export async function business(id){ return unwrap(await db.from("businesses").select("*").eq("id",id).limit(1),"business")?.[0]||null; }
export async function businesses(type=null){
  let q=db.from("businesses").select("*").eq("is_global",true).neq("status","paused").order("name");
  if(type) q=q.eq("business_type",type);
  return unwrap(await q,"businesses");
}
export async function ownedCharacter(id,userId){
  const c=await character(id);
  if(!c || c.owner_discord_id!==userId) throw new Error("That character does not belong to you.");
  return c;
}
export async function requireChecking(characterId){
  const a=await account(characterId,"checking");
  if(!a) throw new Error("This character needs a Checking account first. Use /bank.");
  return a;
}