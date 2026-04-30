# JOHN BOT FULL VERSION (HELP + CARS + HOUSING INCLUDED)

import os
import discord
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

intents = discord.Intents.all()
bot = commands.Bot(command_prefix="!", intents=intents, help_command=None)

@bot.command()
async def help(ctx):
    embed = discord.Embed(
        title="🤖 John Bot Commands",
        description="Full command list",
        color=discord.Color.blue()
    )

    embed.add_field(name="👤 Characters", value="""
!createchar <name> <trigger>
!setavatar <name>
!chars | !switchchar | !whoami | !deletechar
""", inline=False)

    embed.add_field(name="💰 Economy", value="""
!balance | !deposit | !withdraw
!give | !daily
""", inline=False)

    embed.add_field(name="💼 Jobs", value="""
!jobs | !setjob | !switchjob | !work
!setworkcd <seconds>
""", inline=False)

    embed.add_field(name="🚗 Cars", value="""
!cars
!buycar <car>
!garage
!drive <car> <miles>

ADMIN:
!addcar <name> <price> <desc>
!removecar <name>
!setfuelusage <amount>
""", inline=False)

    embed.add_field(name="🏠 Housing", value="""
!houses
!buyhouse <house>
!myhouses

ADMIN:
!addhouse <name> <price> <desc>
!removehouse <name>
""", inline=False)

    embed.add_field(name="⛽ Gas", value="""
!gas | !fuel | !buygas
""", inline=False)

    embed.add_field(name="🎰 Games", value="""
!coinflip | !slots
""", inline=False)

    embed.set_footer(text="John • RP Economy Bot")

    await ctx.send(embed=embed)

@bot.command()
async def ping(ctx):
    await ctx.send("John is running ✅")

bot.run(TOKEN)
