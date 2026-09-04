import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";

export const STARTER_VORO = 100000;

export function nova(voro = 0) {
  return `N${(Number(voro || 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function toVoro(value) {
  const cleaned = String(value ?? "").replace(/[N,$\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function selectRow(customId, placeholder, options, min = 1, max = 1) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(min)
      .setMaxValues(Math.min(max, options.length))
      .addOptions(options.slice(0, 25))
  );
}

export function buttonRow(items) {
  return new ActionRowBuilder().addComponents(
    ...items.map(x =>
      new ButtonBuilder()
        .setCustomId(x.id)
        .setLabel(x.label)
        .setStyle(x.style ?? ButtonStyle.Secondary)
    )
  );
}

export function isModerator(interaction) {
  return interaction.memberPermissions?.has("Administrator") ||
    interaction.memberPermissions?.has("ManageGuild") ||
    interaction.memberPermissions?.has("ManageRoles");
}

export function randomId(prefix = "TX") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
}

export function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
