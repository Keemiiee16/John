import "dotenv/config";
import express from "express";
import {
  ActionRowBuilder, AttachmentBuilder, ButtonStyle, Client, EmbedBuilder, Events,
  GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import { db, unwrap, characters, character, activeCharacter, setActive, account, businesses, business, ownedCharacter, requireChecking } from "./db.js";
import { registerCommands } from "./commands.js";
import { buttons, isStaff, nova, progressBar, randomId, select, toVoro } from "./utils.js";
import { vyltReceipt, nabitReceipt, vybeReceipt, vantageReceipt, partReceipt } from "./receipts.js";

const TOKEN=process.env.DISCORD_TOKEN, CLIENT_ID=process.env.DISCORD_CLIENT_ID;
if(!TOKEN||!CLIENT_ID) throw new Error("Missing Discord env vars");

const app=express();
app.get("/",(_q,r)=>r.send("John is online."));
app.get("/health",(_q,r)=>r.json({ok:true}));
app.listen(Number(process.env.PORT||3000),()=>console.log("Health server ready"));

if(process.env.REGISTER_COMMANDS!=="false") await registerCommands(TOKEN,CLIENT_ID);

const client=new Client({intents:[GatewayIntentBits.Guilds]});

function modal(id,title,fields){
 const m=new ModalBuilder().setCustomId(id).setTitle(title.slice(0,45));
 m.addComponents(...fields.map(f=>new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(f.id).setLabel(f.label.slice(0,45))
   .setStyle(f.style||TextInputStyle.Short).setRequired(f.required??true)
   .setPlaceholder((f.placeholder||"").slice(0,100))
 )));
 return m;
}
async function active(i){
 const c=await activeCharacter(i.user.id,i.guildId);
 if(!c) throw new Error("No active character. Use /character first.");
 return c;
}
async function charOpts(userId){ return (await characters(userId)).map(c=>({label:c.name,value:c.id})); }
async function showCharacter(i){
 const cs=await characters(i.user.id), a=await activeCharacter(i.user.id,i.guildId);
 return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle("👤 Characters").setDescription(`Global characters: **${cs.length}**\nActive here: **${a?.name||"None"}**`)],components:[buttons([
  {id:"char_create",label:"Create",style:ButtonStyle.Success},{id:"char_switch",label:"Switch"},
  {id:"char_view",label:"View"},{id:"char_edit",label:"Edit"},
  {id:"char_remove",label:"Remove",style:ButtonStyle.Danger}
 ])]});
}
async function showBank(i,c){
 const check=await account(c.id,"checking"), save=await account(c.id,"savings");
 const cash=unwrap(await db.from("character_cash").select("balance_voro").eq("character_id",c.id).limit(1),"cash")?.[0]?.balance_voro||0;
 const rows=[];
 if(!check) rows.push({id:`bank_check:${c.id}`,label:"Open Checking",style:ButtonStyle.Success});
 if(check&&!save) rows.push({id:`bank_save:${c.id}`,label:"Open Savings",style:ButtonStyle.Success});
 rows.push({id:`bank_tx:${c.id}`,label:"Transactions"});
 return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle(`🏦 ${c.name}'s Bank`).addFields(
  {name:"Unbanked",value:nova(cash),inline:true},{name:"Checking",value:check?nova(check.balance_voro):"Not opened",inline:true},
  {name:"Savings",value:save?nova(save.balance_voro):"Not opened",inline:true}
 )],components:[buttons(rows)]});
}
async function showApps(i,c){
 await requireChecking(c.id);
 return i.reply({ephemeral:true,content:"Choose an app:",components:[select("apps_pick","Choose app",[
  {label:"VANTAGE",description:"Marketplace ordering",value:"vantage"},
  {label:"VYLT",description:"Send/request Nova",value:"vylt"},
  {label:"VYBE",description:"Book a ride",value:"vybe"},
  {label:"NABIT",description:"Delivery ordering",value:"nabit"},
  {label:"PAR-T",description:"Bus/train/light rail tickets",value:"part"}
 ])]});
}

client.on(Events.InteractionCreate, async i=>{
 try{
  if(i.isChatInputCommand()){
   if(i.commandName==="character") return showCharacter(i);
   if(i.commandName==="bank") return showBank(i,await active(i));
   if(i.commandName==="apps") return showApps(i,await active(i));
   if(i.commandName==="drive"){
    const c=await active(i);
    return i.reply({ephemeral:true,content:"Where are you driving?",components:[select(`drive:${c.id}`,"Where are you driving?",[
     {label:"Quick Errand",value:"quick_errand"},{label:"Around Town",value:"around_town"},{label:"Across Town",value:"across_town"},
     {label:"Road Trip",value:"road_trip"},{label:"Custom Distance",value:"custom"}
    ])]});
   }
   if(i.commandName==="vehicle"){
    const c=await active(i);
    const state=unwrap(await db.from("character_vehicle_state").select("active_vehicle_id").eq("character_id",c.id).limit(1),"vehicle state")?.[0];
    let v=null;
    if(state?.active_vehicle_id) v=unwrap(await db.from("vehicles").select("*").eq("id",state.active_vehicle_id).limit(1),"vehicle")?.[0];
    if(!v){
      const vs=unwrap(await db.from("vehicles").select("*").eq("character_id",c.id),"vehicles");
      if(!vs?.length) return i.reply({ephemeral:true,content:"No vehicles yet. A moderator can add one with /create."});
      return i.reply({ephemeral:true,content:"Choose your active vehicle:",components:[select(`vehicle_set:${c.id}`,"Choose vehicle",vs.map(x=>({label:x.vehicle_name,value:x.id})))]});
    }
    return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle(`🚘 ${c.name}'s ${v.vehicle_name}`).setDescription(
      `**Fuel:** ${progressBar(v.fuel_percentage)} ${Math.round(v.fuel_percentage)}%\n\n**Estimated range:** ${Math.round(v.estimated_range_miles||0)} miles\n\n**Condition:** ${Math.round(v.condition_percentage)}%\n\n**Insurance:** ${v.insurance_status}\n\n**Registration:** ${v.registration_status}`
    )]});
   }
   if(i.commandName==="subscriptions"){
    const c=await active(i);
    const s=unwrap(await db.from("subscriptions").select("*").eq("character_id",c.id),"subs");
    return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle(`📆 ${c.name}'s Subscriptions`).setDescription(
      s?.length?s.map(x=>`**${x.name}** — ${nova(x.monthly_cost_voro)}/month • ${x.status}`).join("\n"):"None"
    )]});
   }
   if(i.commandName==="action"){
    const c=await active(i);
    const s=unwrap(await db.from("subscriptions").select("id").eq("character_id",c.id).eq("status","active"),"subs");
    if(!s?.length) return i.reply({ephemeral:true,content:"No active subscription actions."});
    const acts=unwrap(await db.from("subscription_actions").select("id,action_name,subscription_id").in("subscription_id",s.map(x=>x.id)).eq("is_active",true),"acts");
    if(!acts?.length) return i.reply({ephemeral:true,content:"No active subscription actions."});
    return i.reply({ephemeral:true,content:"Choose an action:",components:[select(`subaction:${c.id}`,"Choose action",acts.map(a=>({label:a.action_name,value:a.id})))]});
   }
   if(i.commandName==="shop"){
    const c=await active(i); await requireChecking(c.id);
    return i.reply({ephemeral:true,content:"Choose:",components:[select(`shoptype:${c.id}`,"Shop or Restaurant",[
     {label:"Shop",value:"shop"},{label:"Restaurant",value:"restaurant"}
    ])]});
   }
   if(i.commandName==="business"){
    const c=await active(i);
    return i.reply({ephemeral:true,content:"Business options:",components:[select(`bizmenu:${c.id}`,"Choose",[
     {label:"Apply to a Business",value:"apply"},{label:"My Businesses",value:"mine"},{label:"Employees / Applications",value:"staff"}
    ])]});
   }
   if(i.commandName==="create"){
    if(!isStaff(i)) throw new Error("Moderator permission required.");
    return i.reply({ephemeral:true,content:"What do you want to add?",components:[select("create_kind","Choose",[
     {label:"Job",value:"job"},{label:"Property",value:"property"},{label:"Vehicle",value:"vehicle"},
     {label:"Business",value:"business"},{label:"Subscription",value:"subscription"}
    ])]});
   }
   if(i.commandName==="fire"){
    const c=await active(i);
    const owned=unwrap(await db.from("businesses").select("*").eq("owner_character_id",c.id),"owned");
    const perms=unwrap(await db.from("business_staff_permissions").select("business_id").eq("character_id",c.id).eq("can_fire",true),"perms");
    const ids=[...(owned||[]).map(x=>x.id),...(perms||[]).map(x=>x.business_id)];
    if(!ids.length) throw new Error("No businesses available to fire from.");
    const bs=unwrap(await db.from("businesses").select("*").in("id",ids),"bs");
    return i.reply({ephemeral:true,content:"Choose business:",components:[select(`firebiz:${c.id}`,"Choose business",bs.map(b=>({label:b.name,value:b.id})))]});
   }
   if(i.commandName==="admin"){
    if(!i.memberPermissions?.has("Administrator")) throw new Error("Administrator required.");
    const accts=unwrap(await db.from("bank_accounts").select("account_type,balance_voro").eq("status","active"),"accts");
    const personal=(accts||[]).filter(x=>x.account_type!=="business").reduce((a,x)=>a+Number(x.balance_voro||0),0);
    const biz=(accts||[]).filter(x=>x.account_type==="business").reduce((a,x)=>a+Number(x.balance_voro||0),0);
    return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle("🛠️ Admin Dashboard").addFields(
      {name:"Personal Nova",value:nova(personal),inline:true},{name:"Business Nova",value:nova(biz),inline:true}
    )]});
   }
   if(i.commandName==="me"){
    const c=await active(i), check=await account(c.id,"checking"), save=await account(c.id,"savings");
    return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle(`✨ ${c.name}`).addFields(
      {name:"Checking",value:check?nova(check.balance_voro):"Not opened",inline:true},
      {name:"Savings",value:save?nova(save.balance_voro):"Not opened",inline:true}
    )]});
   }
   return i.reply({ephemeral:true,content:"This command is included in the build and ready for the next wiring pass."});
  }

  if(i.isButton()){
   if(i.customId==="char_create") return i.showModal(modal("char_create_modal","Create Character",[
    {id:"name",label:"Character Name"},{id:"age",label:"Age (optional)",required:false}
   ]));
   if(["char_switch","char_view","char_edit","char_remove"].includes(i.customId)){
    const o=await charOpts(i.user.id); if(!o.length) return i.reply({ephemeral:true,content:"No characters yet."});
    const act=i.customId.replace("char_","");
    return i.reply({ephemeral:true,content:`Choose a character to ${act}:`,components:[select(`charpick:${act}`,"Choose character",o)]});
   }
   const [id,arg]=i.customId.split(":");
   if(id==="bank_check"){ await ownedCharacter(arg,i.user.id); unwrap(await db.rpc("open_checking_account",{p_character_id:arg}),"open checking"); return i.reply({ephemeral:true,content:"✅ Checking opened and starter N1,000.00 deposited."});}
   if(id==="bank_save"){ await ownedCharacter(arg,i.user.id); unwrap(await db.rpc("open_savings_account",{p_character_id:arg}),"open savings"); return i.reply({ephemeral:true,content:"✅ Savings opened."});}
  }

  if(i.isStringSelectMenu()){
   const [id,arg]=i.customId.split(":");
   if(id==="charpick"){
    const action=arg, cid=i.values[0], c=await ownedCharacter(cid,i.user.id);
    if(action==="switch"){ await setActive(i.user.id,i.guildId,cid); return i.reply({ephemeral:true,content:`✅ Active character switched to **${c.name}**.`});}
    if(action==="view") return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle(c.name).setDescription(`Age: ${c.age??"—"}`)]});
    if(action==="edit") return i.showModal(modal(`char_edit_modal:${cid}`,"Edit Character",[{id:"name",label:"Character Name"},{id:"age",label:"Age (optional)",required:false}]));
    if(action==="remove") return i.showModal(modal(`char_remove_modal:${cid}`,"Remove Character",[{id:"confirm",label:`Type ${c.name} exactly to remove`,placeholder:c.name}]));
   }
   if(id==="vehicle_set"){
    const cid=arg, vid=i.values[0]; await ownedCharacter(cid,i.user.id);
    unwrap(await db.from("character_vehicle_state").upsert({character_id:cid,active_vehicle_id:vid},{onConflict:"character_id"}),"set vehicle");
    return i.reply({ephemeral:true,content:"✅ Active vehicle updated."});
   }
   if(id==="subaction"){
    const cid=arg, act=i.values[0]; const c=await ownedCharacter(cid,i.user.id);
    const out=unwrap(await db.rpc("get_subscription_action_outcome",{p_subscription_action_id:act}),"action outcome")?.[0];
    return i.reply({content:(out?.message_text||"Action complete.").replaceAll("{character}",c.name)});
   }
   if(i.customId==="apps_pick"){
    const c=await active(i), app=i.values[0];
    if(app==="vylt") return i.reply({ephemeral:true,content:"VYLT",components:[select(`vyltmenu:${c.id}`,"Choose",[
      {label:"Send Nova",value:"send"},{label:"Request Nova",value:"request"},{label:"Activity",value:"activity"}
    ])]});
    if(app==="nabit") return i.reply({ephemeral:true,content:"NABIT",components:[select(`nabitbiz:${c.id}`,"Choose restaurant/shop",(await businesses()).map(b=>({label:b.name,value:b.id})))]});
    if(app==="vantage") return i.reply({ephemeral:true,content:"VANTAGE",components:[select(`vantagecat:${c.id}`,"Choose category",[
      {label:"Electronics",value:"electronics"},{label:"Home",value:"home"},{label:"Clothing",value:"clothing"},
      {label:"Beauty",value:"beauty"},{label:"Furniture",value:"furniture"},{label:"Miscellaneous",value:"miscellaneous"}
    ])]});
    if(app==="vybe") return i.reply({ephemeral:true,content:"VYBE",components:[select(`vybedest:${c.id}`,"Transportation point",[
      {label:"Home",value:"home"},{label:"School",value:"school"},{label:"Work",value:"work"},{label:"Airport",value:"airport"},{label:"Hospital",value:"hospital"},{label:"Other",value:"other"}
    ])]});
    if(app==="part") return i.reply({ephemeral:true,content:"PAR-T GO",components:[select(`parttype:${c.id}`,"Transit type",[
      {label:"Bus",value:"bus"},{label:"Light Rail",value:"light_rail"},{label:"Train",value:"train"}
    ])]});
   }
   if(id==="parttype"){
    const cid=arg, transit=i.values[0];
    return i.reply({ephemeral:true,content:"Choose ticket type:",components:[select(`partticket:${cid}:${transit}`,"Ticket type",[
      {label:"Single Ride",value:"single"},{label:"Round Trip",value:"round"},{label:"Day Pass",value:"day"},
      {label:"Weekly Pass",value:"weekly"},{label:"Monthly Pass",value:"monthly"}
    ])]});
   }
   if(id==="partticket"){
    const [cid,transit]=arg.split(":"); // fallback not used due to split structure
   }
  }

  if(i.isModalSubmit()){
   const [id,arg]=i.customId.split(":");
   if(id==="char_create_modal"){
    const name=i.fields.getTextInputValue("name").trim(), ageRaw=i.fields.getTextInputValue("age").trim();
    if(!name) throw new Error("Character name required.");
    const age=ageRaw?Number(ageRaw):null;
    const c=unwrap(await db.from("characters").insert({owner_discord_id:i.user.id,name,age:Number.isFinite(age)?age:null}).select().single(),"create character");
    await setActive(i.user.id,i.guildId,c.id);
    return i.reply({ephemeral:true,content:`✅ **${c.name}** created and set active. Starter funds: **N1,000.00**.`});
   }
   if(id==="char_edit_modal"){
    const c=await ownedCharacter(arg,i.user.id), name=i.fields.getTextInputValue("name").trim(), ageRaw=i.fields.getTextInputValue("age").trim();
    unwrap(await db.from("characters").update({name:name||c.name,age:ageRaw?Number(ageRaw):c.age}).eq("id",arg),"edit character");
    return i.reply({ephemeral:true,content:"✅ Character updated."});
   }
   if(id==="char_remove_modal"){
    const c=await ownedCharacter(arg,i.user.id), confirm=i.fields.getTextInputValue("confirm");
    if(confirm!==c.name) throw new Error("Character name did not match. Nothing was removed.");
    unwrap(await db.from("characters").delete().eq("id",arg),"remove character");
    return i.reply({ephemeral:true,content:`🗑️ **${c.name}** was removed.`});
   }
  }
 }catch(e){
  console.error(e);
  const payload={ephemeral:true,content:`⚠️ ${e.message||"Something went wrong."}`};
  if(i.deferred||i.replied) await i.followUp(payload).catch(()=>{});
  else await i.reply(payload).catch(()=>{});
 }
});

client.once(Events.ClientReady,c=>console.log(`John logged in as ${c.user.tag}`));
await client.login(TOKEN);