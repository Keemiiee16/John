import { REST, Routes, SlashCommandBuilder } from "discord.js";
const defs=[
 ["character","Create, switch, view, edit or remove characters"],
 ["me","Open your active character dashboard"],
 ["bank","Open and manage character bank accounts"],
 ["vehicle","View your garage and active vehicle"],
 ["drive","Drive your active character's vehicle"],
 ["property","View properties and housing contracts"],
 ["job","View jobs, paychecks and work"],
 ["subscriptions","View monthly subscriptions"],
 ["action","Use a subscription action"],
 ["shop","Shop at stores and restaurants"],
 ["apps","Open Vantage, VYLT, VYBE, NABIT or PAR-T"],
 ["notifications","Manage John notifications"],
 ["business","Apply to or manage a business"],
 ["fire","Fire an employee from a business you own/manage"],
 ["create","Moderator: add jobs, properties, vehicles, businesses or subscriptions"],
 ["manage","Moderator: manage economy records"],
 ["admin","Admin economy dashboard, logs and settings"]
];
export const commands=defs.map(([n,d])=>new SlashCommandBuilder().setName(n).setDescription(d).toJSON());
export async function registerCommands(token,clientId){
 const rest=new REST({version:"10"}).setToken(token);
 await rest.put(Routes.applicationCommands(clientId),{body:commands});
 console.log(`Registered ${commands.length} global commands.`);
}