import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  ["character","Create, switch, view, edit, or remove characters"],
  ["me","View your active character dashboard"],
  ["bank","Open Equity Financial"],
  ["vehicle","View your garage and active vehicle"],
  ["drive","Drive your active vehicle"],
  ["property","View housing and property"],
  ["job","View employment and work shifts"],
  ["subscriptions","View monthly subscriptions"],
  ["action","Use a subscription action"],
  ["shop","Shop at stores and restaurants"],
  ["apps","Open Vantage, VYLT, VYBE, NABIT, or PAR-T"],
  ["business","Apply to or manage a business"],
  ["fire","Fire a business employee"],
  ["notifications","Manage John notifications"],
  ["create","Moderator creation menu"],
  ["manage","Moderator management menu"],
  ["admin","Admin economy dashboard"]
].map(([name, description]) => new SlashCommandBuilder().setName(name).setDescription(description).toJSON());

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
  console.log(`Registered ${commands.length} global commands.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await registerCommands();
}
