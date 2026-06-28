// bot/deploy-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log(`Registrando ${commands.length} comando(s)...`);

    if (process.env.DISCORD_GUILD_ID) {
      // Comandos de servidor: aparecen al instante. Ideal mientras pruebas.
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: commands }
      );
      console.log('Comandos registrados en el servidor de prueba.');
    } else {
      // Comandos globales: tardan hasta ~1 hora en propagarse.
      await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
      console.log('Comandos globales registrados (pueden tardar un rato en aparecer).');
    }
  } catch (error) {
    console.error(error);
  }
})();
