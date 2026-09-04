import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("character")
    .setDescription("Create, switch, view, edit, or remove characters"),

  new SlashCommandBuilder()
    .setName("me")
    .setDescription("View your active character dashboard"),

  new SlashCommandBuilder()
    .setName("bank")
    .setDescription("Open Equity Financial"),

  new SlashCommandBuilder()
    .setName("vehicle")
    .setDescription("View your garage and active vehicle"),

  new SlashCommandBuilder()
    .setName("drive")
    .setDescription("Drive your active vehicle"),

  new SlashCommandBuilder()
    .setName("property")
    .setDescription("View housing and property"),

  new SlashCommandBuilder()
    .setName("job")
    .setDescription("View employment and work shifts"),

  new SlashCommandBuilder()
    .setName("subscriptions")
    .setDescription("View monthly subscriptions"),

  new SlashCommandBuilder()
    .setName("action")
    .setDescription("Use a subscription action"),

  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Shop at stores and restaurants"),

  new SlashCommandBuilder()
    .setName("apps")
    .setDescription("Open Vantage, VYLT, VYBE, NABIT, or PAR-T"),

  new SlashCommandBuilder()
    .setName("business")
    .setDescription("Apply to or manage a business"),

  new SlashCommandBuilder()
    .setName("fire")
    .setDescription("Fire a business employee"),

  new SlashCommandBuilder()
    .setName("notifications")
    .setDescription("Manage John notifications"),

  new SlashCommandBuilder()
    .setName("create")
    .setDescription("Moderator creation menu"),

  new SlashCommandBuilder()
    .setName("manage")
    .setDescription("Moderator management menu"),

  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Admin economy dashboard")
].map(command => command.toJSON());
