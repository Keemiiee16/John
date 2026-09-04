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
  UserSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

import { registerCommands } from "./register-commands.js";
import { BANK_NAME, PAR_T_FARES, PAR_T_DISCOUNTS } from "./constants.js";
import { db, unwrap, testSupabaseConnection, charactersFor, characterById, activeCharacter, setActiveCharacter, accountFor, requireChecking, ensureOwnedCharacter } from "./db.js";
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

function userSelectRow(customId, placeholder = "Choose a Discord user") {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

async function respond(i, payload) {
  if (i.deferred) return i.editReply(payload);
  if (i.replied) return i.followUp(payload);
  return i.reply(payload);
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

  return respond(i, {
    embeds: [embed],
    files: [new AttachmentBuilder("equity_financial_logo.jpeg", { name:"equity_financial_logo.jpeg" })],
    components
  });
}

async function showCharacters(i) {
  const chars = await charactersFor(i.user.id);
  const active = await activeCharacter(i.user.id, i.guildId);
  return respond(i, {
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
  return respond(i, {
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
  return respond(i, {
    content:`🚌 **PAR-T GO — ${c.name}**\nPlan. Pay. Ride.`,
    components:[selectRow(`part_transit:${c.id}`,"Choose transit type",[
      {label:"Bus",value:"bus"},
      {label:"Light Rail",value:"light_rail"},
      {label:"Train",value:"train"}
    ])]
  });
}


async function adminHome(i) {
  if (!i.memberPermissions?.has("Administrator")) {
    throw new Error("Administrator permission required.");
  }

  const [characters, businesses, jobs, properties, vehicles, subscriptions, accounts, audit] = await Promise.all([
    db.from("characters").select("id", { count: "exact", head: true }),
    db.from("businesses").select("id", { count: "exact", head: true }),
    db.from("jobs").select("id", { count: "exact", head: true }),
    db.from("properties").select("id", { count: "exact", head: true }),
    db.from("vehicles").select("id", { count: "exact", head: true }),
    db.from("subscriptions").select("id", { count: "exact", head: true }),
    db.from("bank_accounts").select("account_type,balance_voro").eq("status","active"),
    db.from("admin_audit_logs").select("*").order("created_at",{ascending:false}).limit(5)
  ]);

  for (const [label, result] of Object.entries({characters,businesses,jobs,properties,vehicles,subscriptions,accounts,audit})) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }

  const rows = accounts.data || [];
  const personal = rows.filter(a => a.account_type !== "business").reduce((n,a)=>n+Number(a.balance_voro||0),0);
  const businessNova = rows.filter(a => a.account_type === "business").reduce((n,a)=>n+Number(a.balance_voro||0),0);

  return respond(i, {
    embeds:[new EmbedBuilder()
      .setTitle("🛠️ John Admin Dashboard")
      .setDescription("Global economy overview and administration.")
      .addFields(
        {name:"Characters", value:String(characters.count || 0), inline:true},
        {name:"Businesses", value:String(businesses.count || 0), inline:true},
        {name:"Jobs", value:String(jobs.count || 0), inline:true},
        {name:"Properties", value:String(properties.count || 0), inline:true},
        {name:"Vehicles", value:String(vehicles.count || 0), inline:true},
        {name:"Subscriptions", value:String(subscriptions.count || 0), inline:true},
        {name:"Personal Nova", value:nova(personal), inline:true},
        {name:"Business Nova", value:nova(businessNova), inline:true}
      )],
    components:[
      selectRow("admin_menu","Choose an admin tool",[
        {label:"Economy Overview",value:"overview"},
        {label:"Balance Adjustment",value:"balance"},
        {label:"Assign Job",value:"assign_job"},
        {label:"End Job",value:"end_job"},
        {label:"Audit Logs",value:"logs"},
        {label:"Economy Settings",value:"settings"},
        {label:"Pending Contracts",value:"contracts"},
        {label:"Business Overview",value:"businesses"}
      ])
    ]
  });
}

async function manageHome(i) {
  if (!isModerator(i)) throw new Error("Moderator permissions required.");

  return respond(i, {
    embeds:[new EmbedBuilder()
      .setTitle("⚙️ Manage John")
      .setDescription("Choose the system you want to manage.")],
    components:[selectRow("manage_kind","Choose what to manage",[
      {label:"Jobs",value:"jobs"},
      {label:"Properties",value:"properties"},
      {label:"Vehicles",value:"vehicles"},
      {label:"Businesses",value:"businesses"},
      {label:"Subscriptions",value:"subscriptions"},
      {label:"Characters",value:"characters"}
    ])]
  });
}

async function appSubmenu(i, appName, c) {
  const menus = {
    vantage: [
      {label:"Start Shopping",value:"shop"},
      {label:"View Cart",value:"cart"},
      {label:"Order History",value:"history"},
      {label:"Track Kinetix Delivery",value:"tracking"}
    ],
    vylt: [
      {label:"Send Nova",value:"send"},
      {label:"Request Nova",value:"request"},
      {label:"Activity",value:"activity"},
      {label:"VYLT Profile",value:"profile"}
    ],
    vybe: [
      {label:"Book a Ride",value:"book"},
      {label:"Scheduled Rides",value:"scheduled"},
      {label:"Ride History",value:"history"}
    ],
    nabit: [
      {label:"Place an Order",value:"order"},
      {label:"Track an Order",value:"tracking"},
      {label:"Order History",value:"history"}
    ]
  };

  const titles = {
    vantage:"VANTAGE",
    vylt:"VYLT",
    vybe:"VYBE",
    nabit:"NABIT"
  };

  return respond(i, {
    embeds:[new EmbedBuilder()
      .setTitle(`📱 ${titles[appName]}`)
      .setDescription(`Using **${c.name}**`)],
    components:[selectRow(`app_action:${appName}:${c.id}`,"Choose an option",menus[appName])]
  });
}

async function manageList(i, kind) {
  const configs = {
    jobs: {table:"jobs", fields:"id,position,employer_name,status", label:r=>`${r.position} — ${r.employer_name}`},
    properties: {table:"properties", fields:"id,name,property_type,status", label:r=>r.name},
    vehicles: {table:"vehicles", fields:"id,vehicle_name,year", label:r=>`${r.year ? r.year+" " : ""}${r.vehicle_name}`},
    businesses: {table:"businesses", fields:"id,name,business_type,status", label:r=>r.name},
    subscriptions: {table:"subscriptions", fields:"id,name,status", label:r=>r.name},
    characters: {table:"characters", fields:"id,name,owner_discord_id", label:r=>r.name}
  };

  const cfg = configs[kind];
  if (!cfg) throw new Error("Unknown management category.");

  const result = await db.from(cfg.table).select(cfg.fields).limit(25);
  const rows = unwrap(result, `manage ${kind}`);

  if (!rows?.length) {
    return respond(i, {content:`There are no ${kind} to manage yet.`});
  }

  return respond(i, {
    content:`Choose a ${kind.slice(0,-1)}:`,
    components:[selectRow(`manage_item:${kind}`,"Choose an item",rows.map(r=>({
      label:cfg.label(r).slice(0,100),
      description:(r.status ? String(r.status) : "").slice(0,100),
      value:r.id
    })))]
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
      console.log(`[COMMAND] /${i.commandName} from ${i.user.id}`);
      const dbHeavyCommands = new Set([
        "character","me","bank","vehicle","drive","property","job",
        "subscriptions","action","shop","apps","business","fire",
        "notifications","create","manage","admin"
      ]);
      if (dbHeavyCommands.has(i.commandName) && !i.deferred && !i.replied) {
        await i.deferReply({ ephemeral: true });
      }

      if (i.commandName === "character") return await showCharacters(i);
      if (i.commandName === "bank") return await bankHome(i, await currentCharacter(i));
      if (i.commandName === "apps") return await appsHome(i, await currentCharacter(i));

      if (i.commandName === "me") {
        const c = await currentCharacter(i);
        const checking = await accountFor(c.id,"checking");
        const savings = await accountFor(c.id,"savings");
        return respond(i, {embeds:[new EmbedBuilder()
          .setTitle(`✨ ${c.name}`)
          .addFields(
            {name:`${BANK_NAME} Checking`,value:checking?nova(checking.balance_voro):"Not opened",inline:true},
            {name:"Savings",value:savings?nova(savings.balance_voro):"Not opened",inline:true}
          )]});
      }

      if (i.commandName === "drive") {
        const c = await currentCharacter(i);
        return respond(i, {content:"Where are you driving?",components:[selectRow(`drive_type:${c.id}`,"Choose trip",[
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
        return respond(i, {embeds:[new EmbedBuilder().setTitle(`📆 ${c.name}'s Subscriptions`)
          .setDescription(rows?.length ? rows.map(s=>`**${s.name}** — ${nova(s.monthly_cost_voro)}/month • ${s.status}`).join("\n") : "None")]});
      }

      if (i.commandName === "action") {
        const c = await currentCharacter(i);
        const subs = unwrap(await db.from("subscriptions").select("id").eq("character_id",c.id).eq("status","active"),"subs");
        const ids = (subs||[]).map(x=>x.id);
        if (!ids.length) throw new Error("No active subscriptions.");
        const acts = unwrap(await db.from("subscription_actions").select("id,action_name").in("subscription_id",ids).eq("is_active",true),"actions");
        if (!acts?.length) throw new Error("No actions are unlocked right now.");
        return respond(i, {content:"Choose an action:",components:[selectRow(`sub_action:${c.id}`,"Subscription Action",acts.map(a=>({label:a.action_name,value:a.id})))]});
      }

      if (i.commandName === "create") {
        if (!isModerator(i)) throw new Error("Moderator permissions required.");
        return respond(i, {content:"What do you want to create?",components:[selectRow("create_kind","Choose",[
          {label:"Job",value:"job"},{label:"Property",value:"property"},{label:"Vehicle",value:"vehicle"},
          {label:"Business",value:"business"},{label:"Subscription",value:"subscription"}
        ])]});
      }

      if (i.commandName === "manage") {
        return await manageHome(i);
      }

      if (i.commandName === "admin") {
        return await adminHome(i);
      }

      if (i.commandName === "fire") {
        return respond(i, {content:"Use your business employee list to select an employee, reason, and Immediate or End of Pay Period. The database firing patch is included in this package."});
      }

      return respond(i, {content:`✅ **${i.commandName}** is installed in John. This package includes the database foundation and interaction framework for this system.`});
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
        if (!opts.length) return respond(i, {content:"You do not have any characters yet."});
        const action = id.replace("character_","");
        return respond(i, {content:`Choose a character to ${action}:`,components:[
          selectRow(`character_${action}_pick`,"Choose your character",opts)
        ]});
      }


      if (id === "job_contract_accept") {
        const jobId = arg;
        const contracts = unwrap(await db.from("job_contracts")
          .select("*")
          .eq("job_id",jobId)
          .limit(1),"job contract accept");
        const contract = contracts?.[0];
        if (!contract) throw new Error("Job contract not found.");
        if (contract.discord_user_id !== i.user.id) throw new Error("This employment contract is not for you.");
        if (contract.status !== "pending") return respond(i,{content:`This contract is already **${contract.status}**.`});

        unwrap(await db.from("job_contracts")
          .update({status:"accepted",accepted_at:new Date().toISOString()})
          .eq("id",contract.id),"accept job contract");
        unwrap(await db.from("jobs")
          .update({status:"active"})
          .eq("id",jobId),"activate job");

        const job = unwrap(await db.from("jobs").select("*").eq("id",jobId).limit(1),"accepted job")?.[0];
        return respond(i,{content:`✅ Employment contract accepted. **${job?.position || "Job"}** is now active.`});
      }

      if (id === "job_contract_decline") {
        const jobId = arg;
        const contracts = unwrap(await db.from("job_contracts")
          .select("*")
          .eq("job_id",jobId)
          .limit(1),"job contract decline");
        const contract = contracts?.[0];
        if (!contract) throw new Error("Job contract not found.");
        if (contract.discord_user_id !== i.user.id) throw new Error("This employment contract is not for you.");
        if (contract.status !== "pending") return respond(i,{content:`This contract is already **${contract.status}**.`});

        unwrap(await db.from("job_contracts")
          .update({status:"declined"})
          .eq("id",contract.id),"decline job contract");
        unwrap(await db.from("jobs")
          .update({status:"ended"})
          .eq("id",jobId),"decline job");

        return respond(i,{content:"❌ Employment contract declined."});
      }

      if (id === "bank_open_checking") {
        await ensureOwnedCharacter(arg,i.user.id);
        unwrap(await db.rpc("open_checking_account",{p_character_id:arg}),"open checking");
        return respond(i, {content:`✅ **${BANK_NAME} Checking opened.** Your starter Nova has been deposited.`});
      }

      if (id === "bank_open_savings") {
        await ensureOwnedCharacter(arg,i.user.id);
        unwrap(await db.rpc("open_savings_account",{p_character_id:arg}),"open savings");
        return respond(i, {content:`✅ **${BANK_NAME} Savings opened.**`});
      }

      if (id === "bank_transactions") {
        const c = await ensureOwnedCharacter(arg,i.user.id);
        const accounts = unwrap(await db.from("bank_accounts").select("id").eq("character_id",c.id),"acct ids");
        const ids = (accounts||[]).map(a=>a.id);
        const rows = ids.length ? unwrap(await db.from("transactions").select("*").in("account_id", ids).order("created_at",{ascending:false}).limit(10),"transactions") : [];
        return respond(i, {embeds:[new EmbedBuilder()
          .setTitle(`🏦 ${BANK_NAME} — Recent Transactions`)
          .setDescription(rows?.length ? rows.map(t=>`**${nova(t.amount_voro)}** • ${t.transaction_type || "Transaction"} • <t:${Math.floor(new Date(t.created_at).getTime()/1000)}:R>`).join("\n") : "No transactions yet.")]});
      }

      if (id === "manage_remove_confirm") {
        if (!isModerator(i)) throw new Error("Moderator permissions required.");
        const parts = i.customId.split(":");
        const kind = parts[1];
        const itemId = parts[2];
        const tableMap = {jobs:"jobs",properties:"properties",vehicles:"vehicles",businesses:"businesses",subscriptions:"subscriptions",characters:"characters"};
        const table = tableMap[kind];
        if (!table) throw new Error("Unknown management category.");
        unwrap(await db.from(table).delete().eq("id",itemId),`remove ${kind}`);
        unwrap(await db.from("admin_audit_logs").insert({
          guild_id:i.guildId,
          moderator_discord_id:i.user.id,
          action_type:`remove_${kind}`,
          details:{id:itemId}
        }),"audit remove");
        return respond(i,{content:`✅ ${kind.slice(0,-1)} removed.`});
      }

      if (id === "admin_settings_edit") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");
        return i.showModal(modal("admin_settings_modal","Economy Settings",[
          {id:"starter",label:"Starter Nova",placeholder:"1000.00"},
          {id:"tax",label:"NABIT Tax Percent",placeholder:"9"},
          {id:"overdraft",label:"Allow Overdraft? yes/no",placeholder:"no"}
        ]));
      }
    }


    if (i.isUserSelectMenu()) {
      if (!i.memberPermissions?.has("Administrator")) {
        throw new Error("Administrator permission required.");
      }

      const targetUserId = i.values[0];

      if (i.customId === "admin_assign_job_user") {
        const chars = await charactersFor(targetUserId);
        if (!chars?.length) {
          return respond(i,{content:"That Discord user does not have any John characters yet."});
        }

        return respond(i,{
          content:"Choose which character gets the job:",
          components:[selectRow(
            `admin_assign_job_character:${targetUserId}`,
            "Choose character",
            chars.map(c=>({label:c.name,value:c.id}))
          )]
        });
      }

      if (i.customId === "admin_end_job_user") {
        const chars = await charactersFor(targetUserId);
        if (!chars?.length) {
          return respond(i,{content:"That Discord user does not have any John characters yet."});
        }

        return respond(i,{
          content:"Choose the character:",
          components:[selectRow(
            `admin_end_job_character:${targetUserId}`,
            "Choose character",
            chars.map(c=>({label:c.name,value:c.id}))
          )]
        });
      }
    }

    if (i.isStringSelectMenu()) {
      const [id,arg1,arg2] = i.customId.split(":");
      const value = i.values[0];

      if (id === "character_switch_pick") {
        const c = await ensureOwnedCharacter(value,i.user.id);
        await setActiveCharacter(i.user.id,i.guildId,c.id);
        return respond(i, {content:`✅ **${c.name}** is now active in this server.`});
      }

      if (id === "character_view_pick") {
        const c = await ensureOwnedCharacter(value,i.user.id);
        return respond(i, {embeds:[new EmbedBuilder().setTitle(`👤 ${c.name}`).setDescription("Global John character")]});
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


      if (id === "admin_assign_job_character") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");
        const targetUserId = arg1;
        const characterId = value;
        const c = await characterById(characterId);
        if (!c || c.owner_discord_id !== targetUserId) throw new Error("That character does not belong to the selected user.");

        return i.showModal(modal(
          `admin_assign_job_modal:${targetUserId}:${characterId}`,
          `Assign Job — ${c.name}`,
          [
            {id:"employer",label:"Employer"},
            {id:"position",label:"Position / Job Title"},
            {id:"pay",label:"Pay Amount in Nova",placeholder:"Example: 25.00"},
            {id:"pay_info",label:"Pay Type | Pay Schedule",placeholder:"hourly | weekly"},
            {id:"hours",label:"Weekly Hours / Schedule",required:false,placeholder:"40 or Mon-Fri 9-5"}
          ]
        ));
      }

      if (id === "admin_end_job_character") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");
        const targetUserId = arg1;
        const characterId = value;
        const c = await characterById(characterId);
        if (!c || c.owner_discord_id !== targetUserId) throw new Error("That character does not belong to the selected user.");

        const jobs = unwrap(await db.from("jobs")
          .select("id,employer_name,position,pay_type,pay_amount_voro,status")
          .eq("character_id",characterId)
          .in("status",["pending","active","on_leave","suspended"])
          .order("created_at",{ascending:false})
          .limit(25),"admin end jobs");

        if (!jobs?.length) return respond(i,{content:`**${c.name}** has no current jobs to end.`});

        return respond(i,{
          content:`Choose which job to end for **${c.name}**:`,
          components:[selectRow(
            `admin_end_job_pick:${targetUserId}:${characterId}`,
            "Choose job",
            jobs.map(j=>({
              label:`${j.position} — ${j.employer_name}`.slice(0,100),
              description:`${j.status} • ${nova(j.pay_amount_voro)} ${j.pay_type}`.slice(0,100),
              value:j.id
            }))
          )]
        });
      }

      if (id === "admin_end_job_pick") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");
        const targetUserId = arg1;
        const characterId = arg2;
        const jobId = value;

        const jobs = unwrap(await db.from("jobs")
          .select("*")
          .eq("id",jobId)
          .eq("character_id",characterId)
          .limit(1),"job to end");
        const job = jobs?.[0];
        if (!job) throw new Error("Job not found.");

        return i.showModal(modal(
          `admin_end_job_modal:${targetUserId}:${characterId}:${jobId}`,
          "End Job",
          [
            {id:"reason",label:"Reason for ending job",required:false,placeholder:"Optional"},
            {id:"effective",label:"Effective",placeholder:"immediate or end of pay period",value:"immediate"}
          ]
        ));
      }

      if (id === "apps_pick") {
        const c = await currentCharacter(i);
        if (value === "part") return await partHome(i,c);
        if (["vantage","vylt","vybe","nabit"].includes(value)) {
          return await appSubmenu(i,value,c);
        }
        throw new Error("Unknown app.");
      }

      if (id === "app_action") {
        const appName = arg1;
        const characterId = arg2;
        const c = await ensureOwnedCharacter(characterId,i.user.id);

        if (appName === "vylt") {
          if (value === "send") {
            await requireChecking(c.id);
            return i.showModal(modal(`vylt_send:${c.id}`,"VYLT — Send Nova",[
              {id:"recipient",label:"Recipient Discord User ID"},
              {id:"amount",label:"Amount in Nova",placeholder:"25.00"},
              {id:"note",label:"Note",required:false}
            ]));
          }
          if (value === "request") {
            return i.showModal(modal(`vylt_request:${c.id}`,"VYLT — Request Nova",[
              {id:"recipient",label:"Recipient Discord User ID"},
              {id:"amount",label:"Amount in Nova",placeholder:"25.00"},
              {id:"note",label:"Note",required:false}
            ]));
          }
          if (value === "activity") {
            const rows = unwrap(await db.from("vylt_transfers")
              .select("*")
              .or(`sender_character_id.eq.${c.id},receiver_character_id.eq.${c.id}`)
              .order("created_at",{ascending:false})
              .limit(10),"VYLT activity");
            return respond(i,{embeds:[new EmbedBuilder().setTitle("💸 VYLT Activity")
              .setDescription(rows?.length ? rows.map(r=>`${nova(r.amount_voro)} • ${r.status}`).join("\n") : "No VYLT activity yet.")]});
          }
          if (value === "profile") {
            const rows = unwrap(await db.from("vylt_profiles").select("*").eq("character_id",c.id).limit(1),"VYLT profile");
            return respond(i,{embeds:[new EmbedBuilder().setTitle("💚 VYLT Profile")
              .setDescription(rows?.[0] ? `Handle: **${rows[0].vylt_handle}**` : "No VYLT profile yet.")]});
          }
        }

        if (appName === "vybe") {
          if (value === "book") {
            await requireChecking(c.id);
            return i.showModal(modal(`vybe_book:${c.id}`,"VYBE — Book Ride",[
              {id:"destination",label:"Destination",placeholder:"Home, School, Work, Airport..."},
              {id:"distance",label:"Distance",placeholder:"1-5, 5-10, 10-20, 20-40, 40+"},
              {id:"ride_type",label:"Ride Type",placeholder:"Go, Plus, Black, XL, Student..."},
              {id:"riders",label:"Number of Riders",placeholder:"1"},
              {id:"preferences",label:"Preferences",required:false,placeholder:"Quiet, Pet Friendly, Child Seat..."}
            ]));
          }
          const rows = unwrap(await db.from("vybe_rides").select("*").eq("character_id",c.id).order("created_at",{ascending:false}).limit(10),"VYBE rides");
          return respond(i,{embeds:[new EmbedBuilder().setTitle(value==="scheduled"?"🚙 Scheduled VYBE Rides":"🚙 VYBE Ride History")
            .setDescription(rows?.length ? rows.map(r=>`${r.ride_type || "VYBE"} • ${r.destination || "Trip"} • ${r.status}`).join("\n") : "No rides yet.")]});
        }

        if (appName === "nabit") {
          if (value === "order") {
            await requireChecking(c.id);
            const businesses = unwrap(await db.from("businesses").select("id,name,business_type").in("business_type",["restaurant","shop"]).eq("status","open").limit(25),"NABIT businesses");
            if (!businesses?.length) return respond(i,{content:"No open restaurants or shops are available for NABIT yet."});
            return respond(i,{content:"Choose where to order from:",components:[selectRow(`nabit_business:${c.id}`,"Choose business",businesses.map(b=>({label:b.name,value:b.id,description:b.business_type})))]});
          }
          const rows = unwrap(await db.from("nabit_orders").select("*").eq("character_id",c.id).order("created_at",{ascending:false}).limit(10),"NABIT orders");
          return respond(i,{embeds:[new EmbedBuilder().setTitle(value==="tracking"?"🛵 NABIT Tracking":"🛵 NABIT Order History")
            .setDescription(rows?.length ? rows.map(r=>`${r.order_number || r.id} • ${r.status} • ${nova(r.total_voro||0)}`).join("\n") : "No NABIT orders yet.")]});
        }

        if (appName === "vantage") {
          if (value === "shop") {
            await requireChecking(c.id);
            return respond(i,{content:"Choose a Vantage category:",components:[selectRow(`vantage_category:${c.id}`,"Category",[
              {label:"Electronics",value:"electronics"},
              {label:"Home",value:"home"},
              {label:"Clothing",value:"clothing"},
              {label:"Beauty",value:"beauty"},
              {label:"Toys & Games",value:"toys_games"},
              {label:"Office & School",value:"office_school"},
              {label:"Kitchen",value:"kitchen"},
              {label:"Furniture",value:"furniture"},
              {label:"Baby & Kids",value:"baby_kids"},
              {label:"Sports & Fitness",value:"sports_fitness"},
              {label:"Auto & Car Accessories",value:"auto"},
              {label:"Pet Supplies",value:"pet"},
              {label:"Jewelry & Accessories",value:"jewelry"},
              {label:"Miscellaneous",value:"misc"}
            ])]});
          }
          const rows = unwrap(await db.from("vantage_orders").select("*").eq("character_id",c.id).order("created_at",{ascending:false}).limit(10),"Vantage orders");
          return respond(i,{embeds:[new EmbedBuilder().setTitle(value==="tracking"?"📦 Kinetix Tracking":"📦 Vantage Orders")
            .setDescription(rows?.length ? rows.map(r=>`${r.order_number || r.id} • ${r.status} • ${nova(r.total_voro||0)}`).join("\n") : "No Vantage orders yet.")]});
        }
      }

      if (id === "manage_kind") {
        if (!isModerator(i)) throw new Error("Moderator permissions required.");
        return await manageList(i,value);
      }

      if (id === "manage_item") {
        if (!isModerator(i)) throw new Error("Moderator permissions required.");
        return respond(i,{
          content:"What do you want to do with this item?",
          components:[selectRow(`manage_action:${arg1}:${value}`,"Choose action",[
            {label:"View Details",value:"view"},
            {label:"Edit",value:"edit"},
            {label:"Remove / End",value:"remove"}
          ])]
        });
      }

      if (id === "manage_action") {
        if (!isModerator(i)) throw new Error("Moderator permissions required.");
        const kind = arg1;
        const itemId = arg2;
        if (value === "view") {
          const tableMap = {jobs:"jobs",properties:"properties",vehicles:"vehicles",businesses:"businesses",subscriptions:"subscriptions",characters:"characters"};
          const table = tableMap[kind];
          const rows = unwrap(await db.from(table).select("*").eq("id",itemId).limit(1),`manage view ${kind}`);
          const row = rows?.[0];
          if (!row) throw new Error("Item not found.");
          return respond(i,{embeds:[new EmbedBuilder().setTitle(`⚙️ ${kind.slice(0,-1)} Details`)
            .setDescription("```json\n"+JSON.stringify(row,null,2).slice(0,3500)+"\n```")]});
        }
        if (value === "edit") {
          return i.showModal(modal(`manage_edit:${kind}:${itemId}`,"Edit Item",[
            {id:"field",label:"Field to change",placeholder:"Example: status, name, pay_amount_voro"},
            {id:"value",label:"New value"}
          ]));
        }
        if (value === "remove") {
          return respond(i,{
            content:"⚠️ Confirm removal/end of this item.",
            components:[buttonRow([
              {id:`manage_remove_confirm:${kind}:${itemId}`,label:"Confirm Remove",style:ButtonStyle.Danger}
            ])]
          });
        }
      }

      if (id === "admin_menu") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");


        if (value === "assign_job") {
          return respond(i,{
            content:"Choose the Discord user who should receive the job:",
            components:[userSelectRow("admin_assign_job_user","Choose employee")]
          });
        }

        if (value === "end_job") {
          return respond(i,{
            content:"Choose the Discord user whose job you want to end:",
            components:[userSelectRow("admin_end_job_user","Choose employee")]
          });
        }

        if (value === "logs") {
          const rows = unwrap(await db.from("admin_audit_logs").select("*").order("created_at",{ascending:false}).limit(10),"audit logs");
          return respond(i,{embeds:[new EmbedBuilder().setTitle("📜 Admin Audit Logs")
            .setDescription(rows?.length ? rows.map(r=>`**${r.action_type}** • <t:${Math.floor(new Date(r.created_at).getTime()/1000)}:R>\n${JSON.stringify(r.details||{}).slice(0,180)}`).join("\n\n") : "No audit logs yet.")]});
        }

        if (value === "settings") {
          const rows = unwrap(await db.from("economy_settings").select("*").eq("guild_id",i.guildId).limit(1),"economy settings");
          const s = rows?.[0];
          return respond(i,{embeds:[new EmbedBuilder().setTitle("⚙️ Economy Settings")
            .setDescription(s ? `Bank: **${s.bank_name}**\nStarter: **${nova(s.starting_balance_voro)}**\nNABIT Tax: **${Number(s.nabit_tax_rate)*100}%**\nOverdraft: **${s.allow_overdraft ? "On" : "Off"}**` : "No guild override exists yet; John is using database defaults.")],
            components:[buttonRow([{id:"admin_settings_edit",label:"Edit Settings",style:ButtonStyle.Primary}])]});
        }

        if (value === "balance") {
          return i.showModal(modal("admin_balance_adjust","Adjust Character Balance",[
            {id:"character_id",label:"Character UUID"},
            {id:"amount",label:"Amount in Nova",placeholder:"100.00 or -50.00"},
            {id:"reason",label:"Reason"}
          ]));
        }

        if (value === "contracts") {
          const jobs = unwrap(await db.from("job_contracts").select("id,status,created_at").eq("status","pending").limit(10),"job contracts");
          const props = unwrap(await db.from("property_contracts").select("id,status,created_at").eq("status","pending").limit(10),"property contracts");
          return respond(i,{embeds:[new EmbedBuilder().setTitle("📝 Pending Contracts")
            .setDescription(`Job contracts: **${jobs?.length||0}**\nProperty contracts: **${props?.length||0}**`)]});
        }

        if (value === "businesses") {
          const rows = unwrap(await db.from("businesses").select("id,name,business_type,status").order("name").limit(25),"business overview");
          return respond(i,{embeds:[new EmbedBuilder().setTitle("🏪 Business Overview")
            .setDescription(rows?.length ? rows.map(b=>`**${b.name}** • ${b.business_type} • ${b.status}`).join("\n") : "No businesses yet.")]});
        }

        return await adminHome(i);
      }

      if (id === "part_transit") {
        const c = await ensureOwnedCharacter(arg1,i.user.id);
        const labels = {bus:"Bus",light_rail:"Light Rail",train:"Train"};
        return respond(i, {content:`${labels[value]} — choose ticket type:`,components:[selectRow(`part_ticket:${c.id}:${value}`,"Ticket type",[
          {label:`Single Ride — ${nova(PAR_T_FARES[value].single)}`,value:"single"},
          {label:`Round Trip — ${nova(PAR_T_FARES[value].round_trip)}`,value:"round_trip"},
          {label:`Day Pass — ${nova(PAR_T_FARES[value].day_pass)}`,value:"day_pass"},
          {label:`Weekly Pass — ${nova(PAR_T_FARES[value].weekly_pass)}`,value:"weekly_pass"},
          {label:`Monthly Pass — ${nova(PAR_T_FARES[value].monthly_pass)}`,value:"monthly_pass"}
        ])]});
      }

      if (id === "part_ticket") {
        const c = await ensureOwnedCharacter(arg1,i.user.id);
        return respond(i, {content:"Choose fare type:",components:[selectRow(`part_discount:${c.id}:${arg2}:${value}`,"Fare type",[
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
        return respond(i, {content:`🎬 **${c.name}** — ${result?.message || result || "Action completed."}`});
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
        return respond(i, {content:`✅ **${name}** was created with **N1,000.00** starter funds and is now active here.`});
      }

      if (id === "character_edit_modal") {
        const c = await ensureOwnedCharacter(parts[1],i.user.id);
        const name = i.fields.getTextInputValue("name").trim();
        unwrap(await db.from("characters").update({name}).eq("id",c.id),"edit character");
        return respond(i, {content:`✅ Character renamed to **${name}**.`});
      }

      if (id === "character_remove_modal") {
        const c = await ensureOwnedCharacter(parts[1],i.user.id);
        const confirm = i.fields.getTextInputValue("confirm_name").trim();
        if (confirm !== c.name) throw new Error(`Name did not match. Type **${c.name}** exactly.`);
        unwrap(await db.from("characters").delete().eq("id",c.id),"remove character");
        return respond(i, {content:`🗑️ **${c.name}** and their attached John data were removed.`});
      }



      if (id === "admin_assign_job_modal") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");

        const targetUserId = parts[1];
        const characterId = parts[2];
        const c = await characterById(characterId);
        if (!c || c.owner_discord_id !== targetUserId) throw new Error("Character/user mismatch.");

        const employer = i.fields.getTextInputValue("employer").trim();
        const position = i.fields.getTextInputValue("position").trim();
        const payVoro = toVoro(i.fields.getTextInputValue("pay"));
        const payInfo = i.fields.getTextInputValue("pay_info").trim();
        const hoursRaw = i.fields.getTextInputValue("hours").trim();

        if (payVoro === null || payVoro < 0) throw new Error("Enter a valid pay amount.");

        const [payTypeRaw, payScheduleRaw] = payInfo.split("|").map(x=>x.trim().toLowerCase());
        const payTypeAliases = {
          salary:"salary",
          hourly:"hourly",
          commission:"commission",
          custom:"custom",
          stipend:"custom"
        };
        const payType = payTypeAliases[payTypeRaw];
        if (!payType) throw new Error("Pay type must be salary, hourly, commission, or custom.");

        const weeklyHours = hoursRaw && !Number.isNaN(Number(hoursRaw)) ? Number(hoursRaw) : null;

        const job = unwrap(await db.from("jobs").insert({
          character_id:characterId,
          employer_name:employer,
          position,
          pay_type:payType,
          pay_amount_voro:payVoro,
          pay_schedule:payScheduleRaw || null,
          weekly_hour_limit:weeklyHours,
          status:"pending"
        }).select().single(),"admin assign job");

        unwrap(await db.from("job_contracts").insert({
          job_id:job.id,
          discord_user_id:targetUserId,
          status:"pending"
        }),"create job contract");

        unwrap(await db.from("admin_audit_logs").insert({
          guild_id:i.guildId,
          moderator_discord_id:i.user.id,
          action_type:"assign_job",
          target_character_id:characterId,
          details:{
            job_id:job.id,
            employer_name:employer,
            position,
            pay_type:payType,
            pay_amount_voro:payVoro,
            pay_schedule:payScheduleRaw || null,
            weekly_hours:weeklyHours,
            schedule_text: hoursRaw || null
          }
        }),"audit assign job");

        let dmSent = false;
        try {
          const user = await client.users.fetch(targetUserId);
          await user.send({
            embeds:[new EmbedBuilder()
              .setTitle("💼 Employment Offer")
              .setDescription(`**${c.name}** has received a new job offer.`)
              .addFields(
                {name:"Employer",value:employer,inline:true},
                {name:"Position",value:position,inline:true},
                {name:"Pay",value:`${nova(payVoro)} • ${payType}`,inline:true},
                {name:"Pay Schedule",value:payScheduleRaw || "Not specified",inline:true},
                {name:"Weekly Hours",value:weeklyHours !== null ? String(weeklyHours) : (hoursRaw || "Not specified"),inline:true}
              )
              .setFooter({text:"Accepting activates the job and payroll."})],
            components:[buttonRow([
              {id:`job_contract_accept:${job.id}`,label:"Accept Job",style:ButtonStyle.Success},
              {id:`job_contract_decline:${job.id}`,label:"Decline",style:ButtonStyle.Danger}
            ])]
          });
          dmSent = true;
        } catch (e) {
          console.warn("[Job contract DM failed]", e.message);
        }

        return respond(i,{
          content:`✅ Job assigned to **${c.name}** as **${position}** at **${employer}**. Contract is pending.${dmSent ? " I sent the player a DM to accept it." : " I couldn't DM them, so the contract remains pending in John."}`
        });
      }

      if (id === "admin_end_job_modal") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");

        const targetUserId = parts[1];
        const characterId = parts[2];
        const jobId = parts[3];
        const reason = i.fields.getTextInputValue("reason").trim();
        const effectiveRaw = i.fields.getTextInputValue("effective").trim().toLowerCase();

        const jobs = unwrap(await db.from("jobs").select("*").eq("id",jobId).eq("character_id",characterId).limit(1),"end job");
        const job = jobs?.[0];
        if (!job) throw new Error("Job not found.");

        if (effectiveRaw.includes("pay period")) {
          // Current jobs schema has no dedicated termination_effective_at field for general jobs,
          // so mark suspended and preserve the request in audit log until payroll scheduling is added.
          unwrap(await db.from("jobs").update({status:"suspended"}).eq("id",jobId),"schedule job ending");
          unwrap(await db.from("admin_audit_logs").insert({
            guild_id:i.guildId,
            moderator_discord_id:i.user.id,
            action_type:"schedule_end_job",
            target_character_id:characterId,
            details:{job_id:jobId,reason,effective:"end_of_pay_period"}
          }),"audit scheduled end job");
        } else {
          unwrap(await db.from("jobs").update({status:"ended"}).eq("id",jobId),"end job now");
          unwrap(await db.from("admin_audit_logs").insert({
            guild_id:i.guildId,
            moderator_discord_id:i.user.id,
            action_type:"end_job",
            target_character_id:characterId,
            details:{job_id:jobId,reason,effective:"immediate"}
          }),"audit end job");
        }

        try {
          const user = await client.users.fetch(targetUserId);
          await user.send(`💼 **${job.position}** at **${job.employer_name}** for your character has been ${effectiveRaw.includes("pay period") ? "set to end at the end of the pay period" : "ended"}${reason ? `.\nReason: ${reason}` : "."}`);
        } catch {}

        return respond(i,{content:`✅ **${job.position}** at **${job.employer_name}** has been ${effectiveRaw.includes("pay period") ? "scheduled to end" : "ended"}.`});
      }

      if (id === "manage_edit") {
        if (!isModerator(i)) throw new Error("Moderator permissions required.");
        const kind = parts[1];
        const itemId = parts[2];
        const field = i.fields.getTextInputValue("field").trim();
        let newValue = i.fields.getTextInputValue("value").trim();
        const tableMap = {jobs:"jobs",properties:"properties",vehicles:"vehicles",businesses:"businesses",subscriptions:"subscriptions",characters:"characters"};
        const allowed = {
          jobs:["position","employer_name","pay_amount_voro","pay_type","pay_schedule","status"],
          properties:["name","property_type","ownership_status","bedrooms","bathrooms","monthly_cost_voro","status"],
          vehicles:["vehicle_name","year","fuel_type","fuel_percentage","mileage","condition_percentage","insurance_status","registration_status","estimated_range_miles","value_voro"],
          businesses:["name","business_type","status"],
          subscriptions:["name","tier","monthly_cost_voro","next_charge_date","status"],
          characters:["name"]
        };
        if (!allowed[kind]?.includes(field)) throw new Error(`That field cannot be edited here. Allowed: ${allowed[kind]?.join(", ")}`);
        if (["pay_amount_voro","monthly_cost_voro","value_voro"].includes(field)) newValue = Math.round(Number(newValue) * 100);
        else if (["year","bedrooms","bathrooms","fuel_percentage","mileage","condition_percentage","estimated_range_miles"].includes(field)) newValue = Number(newValue);

        unwrap(await db.from(tableMap[kind]).update({[field]:newValue}).eq("id",itemId),`edit ${kind}`);
        unwrap(await db.from("admin_audit_logs").insert({
          guild_id:i.guildId,
          moderator_discord_id:i.user.id,
          action_type:`edit_${kind}`,
          details:{id:itemId,field,new_value:newValue}
        }),"audit edit");
        return respond(i,{content:`✅ Updated **${field}**.`});
      }

      if (id === "admin_settings_modal") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");
        const starter = toVoro(i.fields.getTextInputValue("starter"));
        const taxPct = Number(i.fields.getTextInputValue("tax"));
        const overdraftRaw = i.fields.getTextInputValue("overdraft").trim().toLowerCase();
        if (starter === null || !Number.isFinite(taxPct)) throw new Error("Enter valid numbers.");
        const allowOverdraft = ["yes","true","on","1"].includes(overdraftRaw);

        unwrap(await db.from("economy_settings").upsert({
          guild_id:i.guildId,
          bank_name:BANK_NAME,
          starting_balance_voro:starter,
          nabit_tax_rate:taxPct/100,
          allow_overdraft:allowOverdraft
        },{onConflict:"guild_id"}),"update economy settings");

        unwrap(await db.from("admin_audit_logs").insert({
          guild_id:i.guildId,
          moderator_discord_id:i.user.id,
          action_type:"economy_settings_update",
          details:{starting_balance_voro:starter,nabit_tax_rate:taxPct/100,allow_overdraft:allowOverdraft}
        }),"audit settings");

        return respond(i,{content:"✅ Economy settings updated."});
      }

      if (id === "admin_balance_adjust") {
        if (!i.memberPermissions?.has("Administrator")) throw new Error("Administrator permission required.");
        const characterId = i.fields.getTextInputValue("character_id").trim();
        const amount = toVoro(i.fields.getTextInputValue("amount"));
        const reason = i.fields.getTextInputValue("reason").trim();
        if (amount === null || amount === 0) throw new Error("Enter a non-zero amount.");

        const account = await accountFor(characterId,"checking");
        if (!account) throw new Error("That character does not have an Equity Financial Checking account.");

        const next = Number(account.balance_voro) + amount;
        if (next < 0) throw new Error("That adjustment would make the account negative.");

        unwrap(await db.from("bank_accounts").update({balance_voro:next}).eq("id",account.id),"admin balance update");
        unwrap(await db.from("transactions").insert({
          character_id:characterId,
          account_id:account.id,
          amount_voro:Math.abs(amount),
          direction:amount>0?"credit":"debit",
          transaction_type:"admin_adjustment",
          description:reason,
          reference_type:"admin",
          balance_after_voro:next
        }),"admin transaction");
        unwrap(await db.from("admin_audit_logs").insert({
          guild_id:i.guildId,
          moderator_discord_id:i.user.id,
          action_type:"balance_adjustment",
          target_character_id:characterId,
          details:{amount_voro:amount,reason}
        }),"audit balance");

        return respond(i,{content:`✅ Balance adjusted by **${nova(amount)}**. New balance: **${nova(next)}**.`});
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
        unwrap(await db.from("bank_accounts").update({balance_voro:newBalance}).eq("id",account.id),"PAR-T debit");
        const ref = randomId("PART");
        unwrap(await db.from("transactions").insert({
          character_id: c.id,
          account_id: account.id,
          amount_voro: fare,
          direction: "debit",
          transaction_type: "par_t_ticket",
          description: `${transitType} ${ticketType}`,
          reference_type: "part_ticket",
          balance_after_voro: newBalance
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
    const payload = { content:`⚠️ ${err.message || "Something went wrong."}` };
    if (i.deferred) await i.editReply(payload).catch(()=>{});
    else if (i.replied) await i.followUp({ ...payload, ephemeral:true }).catch(()=>{});
    else await i.reply({ ...payload, ephemeral:true }).catch(()=>{});
  }
});

client.on("error", error => console.error("[Discord client error]", error));

client.once(Events.ClientReady, c => console.log(`John logged in as ${c.user.tag}`));

try {
  await testSupabaseConnection();
} catch (error) {
  console.error("[Supabase startup test failed]", error);
}

client.login(process.env.DISCORD_TOKEN);
