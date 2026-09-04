import "dotenv/config";
import express from "express";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

import { registerCommands } from "./register-commands.js";
import { BANK_NAME, PAR_T_FARES, PAR_T_DISCOUNTS } from "./constants.js";
import { db, unwrap, charactersFor, characterById, activeCharacter, setActiveCharacter, accountFor, requireChecking, ensureOwnedCharacter } from "./db.js";
import { buttonRow, isModerator, nova, randomId, selectRow, toVoro } from "./utils.js";
import { renderEquityTransaction, renderPartTicket } from "./receipts.js";

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
  throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const app = express();
app.get("/", (_req, res) => res.send("John is online."));
app.get("/health", (_req, res) => res.json({ ok: true, bot: "John", bank: BANK_NAME }));
app.listen(Number(process.env.PORT || 3000), () => console.log("John health server ready."));

if (process.env.REGISTER_COMMANDS !== "false") await registerCommands();

function modal(id, title, fields) {
  const m = new ModalBuilder().setCustomId(id).setTitle(title.slice(0,45));
  m.addComponents(...fields.map(f => new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label.slice(0,45))
      .setStyle(f.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(f.required ?? true)
      .setPlaceholder((f.placeholder || "").slice(0,100))
      .setValue((f.value || "").slice(0,4000))
  )));
  return m;
}

async function currentCharacter(i) {
  const c = await activeCharacter(i.user.id, i.guildId);
  if (!c) throw new Error("No active character here. Use `/character` first.");
  return c;
}

async function characterOptions(userId) {
  const rows = await charactersFor(userId);
  return rows.map(c => ({ label: c.name.slice(0,100), value: c.id }));
}

async function bankHome(i, c) {
  const checking = await accountFor(c.id, "checking");
  const savings = await accountFor(c.id, "savings");
  const cash = unwrap(await db.from("character_cash").select("balance_voro").eq("character_id", c.id).limit(1), "cash")?.[0]?.balance_voro ?? 0;

  const embed = new EmbedBuilder()
    .setTitle(`🏦 ${BANK_NAME}`)
    .setDescription(`**${c.name}**`)
    .setThumbnail("attachment://equity_financial_logo.jpeg")
    .addFields(
      { name: "Checking", value: checking ? nova(checking.balance_voro) : "Not opened", inline: true },
      { name: "Savings", value: savings ? nova(savings.balance_voro) : "Not opened", inline: true },
      { name: "Unbanked Nova", value: nova(cash), inline: true }
    );

  const components = [];
  const actions = [];
  if (!checking) actions.push({ id:`bank_open_checking:${c.id}`, label:"Open Checking", style:ButtonStyle.Success });
  if (checking && !savings) actions.push({ id:`bank_open_savings:${c.id}`, label:"Open Savings", style:ButtonStyle.Success });
  if (checking && savings) actions.push({ id:`bank_transfer:${c.id}`, label:"Transfer" });
  actions.push({ id:`bank_transactions:${c.id}`, label:"Transactions" });
  if (actions.length) components.push(buttonRow(actions));

  return i.reply({
    ephemeral: true,
    embeds: [embed],
    files: [new AttachmentBuilder("assets/equity_financial_logo.jpeg", { name:"equity_financial_logo.jpeg" })],
    components
  });
}

async function showCharacters(i) {
  const chars = await charactersFor(i.user.id);
  const active = await activeCharacter(i.user.id, i.guildId);
  return i.reply({
    ephemeral:true,
    embeds:[new EmbedBuilder()
      .setTitle("👤 Character System")
      .setDescription(`Global characters: **${chars.length}**\nActive here: **${active?.name || "None"}**`)],
    components:[buttonRow([
      {id:"character_create",label:"Create",style:ButtonStyle.Success},
      {id:"character_switch",label:"Switch"},
      {id:"character_view",label:"View"},
      {id:"character_edit",label:"Edit"},
      {id:"character_remove",label:"Remove",style:ButtonStyle.Danger}
    ])]
  });
}

async function appsHome(i, c) {
  await requireChecking(c.id);
  return i.reply({
    ephemeral:true,
    content:`📱 **${c.name}'s Apps**`,
    components:[selectRow("apps_pick","Choose an app",[
      {label:"Vantage",description:"Marketplace",value:"vantage"},
      {label:"VYLT",description:"Send and request Nova",value:"vylt"},
      {label:"VYBE",description:"Ride share",value:"vybe"},
      {label:"NABIT",description:"Food and shop delivery",value:"nabit"},
      {label:"PAR-T",description:"Bus, light rail, and train tickets",value:"part"}
    ])]
  });
}

async function partHome(i, c) {
  return i.reply({
    ephemeral:true,
    content:`🚌 **PAR-T GO — ${c.name}**\nPlan. Pay. Ride.`,
    components:[selectRow(`part_transit:${c.id}`,"Choose transit type",[
      {label:"Bus",value:"bus"},
      {label:"Light Rail",value:"light_rail"},
      {label:"Train",value:"train"}
    ])]
  });
}

async function savePartTicket({characterId, accountId, transitType, ticketType, fareVoro, discountType, route, departure, arrival}) {
  const ticketId = randomId("PART");
  return unwrap(await db.from("part_tickets").insert({
    character_id: characterId,
    checking_account_id: accountId,
    ticket_id: ticketId,
    transit_type: transitType,
    ticket_type: ticketType,
    discount_type: discountType,
    fare_voro: fareVoro,
    route_name: route || "PAR-T",
    departure: departure || null,
    arrival: arrival || null,
    status: "booked"
  }).select().single(), "savePartTicket");
}

client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === "character") return showCharacters(i);
      if (i.commandName === "bank") return bankHome(i, await currentCharacter(i));
      if (i.commandName === "apps") return appsHome(i, await currentCharacter(i));

      if (i.commandName === "me") {
        const c = await currentCharacter(i);
        const checking = await accountFor(c.id,"checking");
        const savings = await accountFor(c.id,"savings");
        return i.reply({ephemeral:true,embeds:[new EmbedBuilder()
          .setTitle(`✨ ${c.name}`)
          .addFields(
            {name:`${BANK_NAME} Checking`,value:checking?nova(checking.balance_voro):"Not opened",inline:true},
            {name:"Savings",value:savings?nova(savings.balance_voro):"Not opened",inline:true}
          )]});
      }

      if (i.commandName === "drive") {
        const c = await currentCharacter(i);
        return i.reply({ephemeral:true,content:"Where are you driving?",components:[selectRow(`drive_type:${c.id}`,"Choose trip",[
          {label:"Quick Errand",value:"quick_errand"},
          {label:"Around Town",value:"around_town"},
          {label:"Across Town",value:"across_town"},
          {label:"Road Trip",value:"road_trip"},
          {label:"Custom Distance",value:"custom"}
        ])]});
      }

      if (i.commandName === "subscriptions") {
        const c = await currentCharacter(i);
        const rows = unwrap(await db.from("subscriptions").select("*").eq("character_id",c.id).order("created_at"),"subscriptions");
        return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle(`📆 ${c.name}'s Subscriptions`)
          .setDescription(rows?.length ? rows.map(s=>`**${s.name}** — ${nova(s.monthly_cost_voro)}/month • ${s.status}`).join("\n") : "None")]});
      }

      if (i.commandName === "action") {
        const c = await currentCharacter(i);
        const subs = unwrap(await db.from("subscriptions").select("id").eq("character_id",c.id).eq("status","active"),"subs");
        const ids = (subs||[]).map(x=>x.id);
        if (!ids.length) throw new Error("No active subscriptions.");
        const acts = unwrap(await db.from("subscription_actions").select("id,action_name").in("subscription_id",ids).eq("is_active",true),"actions");
        if (!acts?.length) throw new Error("No actions are unlocked right now.");
        return i.reply({ephemeral:true,content:"Choose an action:",components:[selectRow(`sub_action:${c.id}`,"Subscription Action",acts.map(a=>({label:a.action_name,value:a.id})))]});
      }

      if (i.commandName === "create") {
        if (!isModerator(i)) throw new Error("Moderator permissions required.");
        return i.reply({ephemeral:true,content:"What do you want to create?",components:[selectRow("create_kind","Choose",[
          {label:"Job",value:"job"},{label:"Property",value:"property"},{label:"Vehicle",value:"vehicle"},
          {label:"Business",value:"business"},{label:"Subscription",value:"subscription"}
        ])]});
      }

      if (i.commandName === "fire") {
        return i.reply({ephemeral:true,content:"Use your business employee list to select an employee, reason, and Immediate or End of Pay Period. The database firing patch is included in this package."});
      }

      return i.reply({ephemeral:true,content:`✅ **${i.commandName}** is installed in John. This package includes the database foundation and interaction framework for this system.`});
    }

    if (i.isButton()) {
      const [id,arg] = i.customId.split(":");

      if (id === "character_create") {
        return i.showModal(modal("character_create_modal","Create Character",[
          {id:"name",label:"Character Name"}
        ]));
      }

      if (["character_switch","character_view","character_edit","character_remove"].includes(id)) {
        const opts = await characterOptions(i.user.id);
        if (!opts.length) return i.reply({ephemeral:true,content:"You do not have any characters yet."});
        const action = id.replace("character_","");
        return i.reply({ephemeral:true,content:`Choose a character to ${action}:`,components:[
          selectRow(`character_${action}_pick`,"Choose your character",opts)
        ]});
      }

      if (id === "bank_open_checking") {
        await ensureOwnedCharacter(arg,i.user.id);
        unwrap(await db.rpc("open_checking_account",{p_character_id:arg}),"open checking");
        return i.reply({ephemeral:true,content:`✅ **${BANK_NAME} Checking opened.** Your starter Nova has been deposited.`});
      }

      if (id === "bank_open_savings") {
        await ensureOwnedCharacter(arg,i.user.id);
        unwrap(await db.rpc("open_savings_account",{p_character_id:arg}),"open savings");
        return i.reply({ephemeral:true,content:`✅ **${BANK_NAME} Savings opened.**`});
      }

      if (id === "bank_transactions") {
        const c = await ensureOwnedCharacter(arg,i.user.id);
        const accounts = unwrap(await db.from("bank_accounts").select("id").eq("character_id",c.id),"acct ids");
        const ids = (accounts||[]).map(a=>a.id);
        const rows = ids.length ? unwrap(await db.from("transactions").select("*").or(ids.map(x=>`from_account_id.eq.${x},to_account_id.eq.${x}`).join(",")).order("created_at",{ascending:false}).limit(10),"transactions") : [];
        return i.reply({ephemeral:true,embeds:[new EmbedBuilder()
          .setTitle(`🏦 ${BANK_NAME} — Recent Transactions`)
          .setDescription(rows?.length ? rows.map(t=>`**${nova(t.amount_voro)}** • ${t.transaction_type || "Transaction"} • <t:${Math.floor(new Date(t.created_at).getTime()/1000)}:R>`).join("\n") : "No transactions yet.")]});
      }
    }

    if (i.isStringSelectMenu()) {
      const [id,arg1,arg2] = i.customId.split(":");
      const value = i.values[0];

      if (id === "character_switch_pick") {
        const c = await ensureOwnedCharacter(value,i.user.id);
        await setActiveCharacter(i.user.id,i.guildId,c.id);
        return i.reply({ephemeral:true,content:`✅ **${c.name}** is now active in this server.`});
      }

      if (id === "character_view_pick") {
        const c = await ensureOwnedCharacter(value,i.user.id);
        return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle(`👤 ${c.name}`).setDescription("Global John character")]});
      }

      if (id === "character_edit_pick") {
        const c = await ensureOwnedCharacter(value,i.user.id);
        return i.showModal(modal(`character_edit_modal:${c.id}`,"Edit Character",[
          {id:"name",label:"Character Name",value:c.name}
        ]));
      }

      if (id === "character_remove_pick") {
        const c = await ensureOwnedCharacter(value,i.user.id);
        return i.showModal(modal(`character_remove_modal:${c.id}`,"Remove Character",[
          {id:"confirm_name",label:`Type ${c.name} exactly`,placeholder:c.name}
        ]));
      }

      if (id === "apps_pick") {
        const c = await currentCharacter(i);
        if (value === "part") return partHome(i,c);
        return i.reply({ephemeral:true,content:`📱 Opening **${value.toUpperCase()}** for **${c.name}**.`});
      }

      if (id === "part_transit") {
        const c = await ensureOwnedCharacter(arg1,i.user.id);
        const labels = {bus:"Bus",light_rail:"Light Rail",train:"Train"};
        return i.reply({ephemeral:true,content:`${labels[value]} — choose ticket type:`,components:[selectRow(`part_ticket:${c.id}:${value}`,"Ticket type",[
          {label:`Single Ride — ${nova(PAR_T_FARES[value].single)}`,value:"single"},
          {label:`Round Trip — ${nova(PAR_T_FARES[value].round_trip)}`,value:"round_trip"},
          {label:`Day Pass — ${nova(PAR_T_FARES[value].day_pass)}`,value:"day_pass"},
          {label:`Weekly Pass — ${nova(PAR_T_FARES[value].weekly_pass)}`,value:"weekly_pass"},
          {label:`Monthly Pass — ${nova(PAR_T_FARES[value].monthly_pass)}`,value:"monthly_pass"}
        ])]});
      }

      if (id === "part_ticket") {
        const c = await ensureOwnedCharacter(arg1,i.user.id);
        return i.reply({ephemeral:true,content:"Choose fare type:",components:[selectRow(`part_discount:${c.id}:${arg2}:${value}`,"Fare type",[
          {label:"Standard Fare",value:"standard"},
          {label:"Student — 25% Off",value:"student"},
          {label:"Reduced / Accessibility — 50% Off",value:"reduced"}
        ])]});
      }

      if (id === "part_discount") {
        const [characterId,transitType,ticketType] = [arg1,arg2,i.customId.split(":")[3]];
        const c = await ensureOwnedCharacter(characterId,i.user.id);
        const account = await requireChecking(c.id);
        const discountType = value;
        const base = PAR_T_FARES[transitType][ticketType];
        const fare = Math.round(base * (1 - PAR_T_DISCOUNTS[discountType]));
        return i.showModal(modal(`part_route:${c.id}:${transitType}:${ticketType}:${discountType}:${fare}`,"PAR-T Trip Details",[
          {id:"departure",label:"Departure",placeholder:"Where are you leaving from?"},
          {id:"arrival",label:"Arrival",placeholder:"Where are you going?"},
          {id:"route",label:"Route / Line",required:false,placeholder:"Optional route or line"}
        ]));
      }

      if (id === "sub_action") {
        const c = await ensureOwnedCharacter(arg1,i.user.id);
        const result = unwrap(await db.rpc("get_subscription_action_outcome",{p_subscription_action_id:value}),"subscription action");
        return i.reply({ephemeral:false,content:`🎬 **${c.name}** — ${result?.message || result || "Action completed."}`});
      }
    }

    if (i.isModalSubmit()) {
      const parts = i.customId.split(":");
      const id = parts[0];

      if (id === "character_create_modal") {
        const name = i.fields.getTextInputValue("name").trim();
        if (!name) throw new Error("Character name cannot be blank.");
        const c = unwrap(await db.from("characters").insert({
          owner_discord_id:i.user.id,
          name
        }).select().single(),"create character");
        await setActiveCharacter(i.user.id,i.guildId,c.id);
        return i.reply({ephemeral:true,content:`✅ **${name}** was created with **N1,000.00** starter funds and is now active here.`});
      }

      if (id === "character_edit_modal") {
        const c = await ensureOwnedCharacter(parts[1],i.user.id);
        const name = i.fields.getTextInputValue("name").trim();
        unwrap(await db.from("characters").update({name,updated_at:new Date().toISOString()}).eq("id",c.id),"edit character");
        return i.reply({ephemeral:true,content:`✅ Character renamed to **${name}**.`});
      }

      if (id === "character_remove_modal") {
        const c = await ensureOwnedCharacter(parts[1],i.user.id);
        const confirm = i.fields.getTextInputValue("confirm_name").trim();
        if (confirm !== c.name) throw new Error(`Name did not match. Type **${c.name}** exactly.`);
        unwrap(await db.from("characters").delete().eq("id",c.id),"remove character");
        return i.reply({ephemeral:true,content:`🗑️ **${c.name}** and their attached John data were removed.`});
      }

      if (id === "part_route") {
        const [characterId,transitType,ticketType,discountType,fareString] = parts.slice(1);
        const c = await ensureOwnedCharacter(characterId,i.user.id);
        const account = await requireChecking(c.id);
        const fare = Number(fareString);
        if (Number(account.balance_voro) < fare) throw new Error(`Not enough Nova in ${BANK_NAME} Checking.`);

        const departure = i.fields.getTextInputValue("departure").trim();
        const arrival = i.fields.getTextInputValue("arrival").trim();
        const route = i.fields.getTextInputValue("route").trim() || "PAR-T";

        // Charge checking, ledger transaction, then save ticket.
        const newBalance = Number(account.balance_voro) - fare;
        unwrap(await db.from("bank_accounts").update({balance_voro:newBalance,updated_at:new Date().toISOString()}).eq("id",account.id),"PAR-T debit");
        const ref = randomId("PART");
        unwrap(await db.from("transactions").insert({
          from_account_id: account.id,
          amount_voro: fare,
          transaction_type: "par_t_ticket",
          description: `${transitType} ${ticketType}`,
          reference_id: ref
        }),"PAR-T transaction");

        const ticket = await savePartTicket({
          characterId:c.id,
          accountId:account.id,
          transitType,
          ticketType,
          fareVoro:fare,
          discountType,
          route,
          departure,
          arrival
        });

        const now = new Date();
        const image = await renderPartTicket({
          passenger:c.name,
          transitType:transitType.replaceAll("_"," ").toUpperCase(),
          ticketType:ticketType.replaceAll("_"," ").toUpperCase(),
          route,
          departure,
          arrival,
          date:now.toLocaleDateString("en-US"),
          time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
          fareVoro:fare,
          ticketId:ticket.ticket_id,
          status:"BOOKED"
        });

        return i.reply({
          content:`✅ **PAR-T trip booked for ${c.name}.** ${nova(fare)} was charged to ${BANK_NAME} Checking.`,
          files:[new AttachmentBuilder(image,{name:"part-ticket.png"})]
        });
      }
    }
  } catch (err) {
    console.error(err);
    const payload = { ephemeral:true, content:`⚠️ ${err.message || "Something went wrong."}` };
    if (i.replied || i.deferred) await i.followUp(payload).catch(()=>{});
    else await i.reply(payload).catch(()=>{});
  }
});

client.once(Events.ClientReady, c => console.log(`John logged in as ${c.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
