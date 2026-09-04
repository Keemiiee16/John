import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";

export function nova(voro=0) {
  return `N${(Number(voro||0)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
export function toVoro(value) {
  const n = Number(String(value ?? "").replace(/[N,$\s]/g,""));
  return Number.isFinite(n) ? Math.round(n*100) : null;
}
export function progressBar(percent, blocks=10) {
  const p=Math.max(0,Math.min(100,Number(percent||0)));
  const full=Math.round((p/100)*blocks);
  return "█".repeat(full)+"░".repeat(blocks-full);
}
export function isStaff(i) {
  return i.memberPermissions?.has("Administrator") ||
         i.memberPermissions?.has("ManageGuild") ||
         i.memberPermissions?.has("ManageRoles");
}
export function select(id, placeholder, opts, min=1, max=1) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder)
      .setMinValues(min).setMaxValues(Math.min(max,opts.length)).addOptions(opts.slice(0,25))
  );
}
export function buttons(items) {
  return new ActionRowBuilder().addComponents(
    ...items.map(x=>new ButtonBuilder().setCustomId(x.id).setLabel(x.label)
      .setStyle(x.style || ButtonStyle.Secondary).setDisabled(Boolean(x.disabled)))
  );
}
export function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2,8).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;
}
export function escapeXml(s="") {
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&apos;");
}