# JOHN BOT CLEAN VERSION WITH FIXED HELP MENU
import discord
from discord.ext import commands

bot = commands.Bot(command_prefix="!", intents=discord.Intents.all())

@bot.command()
async def help(ctx):
    embed = discord.Embed(
        title="🤖 John Bot Commands",
        description="Full command list",
        color=discord.Color.blue()
    )

    embed.add_field(name="👤 Characters", value="!createchar | !setavatar | !chars | !switchchar | !whoami | !deletechar", inline=False)
    embed.add_field(name="💰 Economy", value="!balance | !deposit | !withdraw | !give | !daily", inline=False)
    embed.add_field(name="🚗 Cars", value="!cars | !buycar | !garage | !drive", inline=False)
    embed.add_field(name="🏠 Housing", value="!houses | !buyhouse | !myhouses", inline=False)
    embed.add_field(name="💼 Jobs", value="!jobs | !setjob | !switchjob | !work", inline=False)

    await ctx.send(embed=embed)

bot.run("YOUR_TOKEN")
