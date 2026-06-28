// bot/index.js
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const supabaseAdmin = require('./supabaseAdmin');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// --- Cargar comandos ---
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
  }
});

// --- Colores según relevancia ---
const COLOR_BY_RELEVANCE = {
  baja: 0x808080,
  media: 0x3498db,
  alta: 0xe67e22,
  critica: 0xe74c3c,
};

function buildEmbedFromLog(log) {
  const embed = new EmbedBuilder()
    .setTitle(log.title)
    .setColor(COLOR_BY_RELEVANCE[log.relevance] ?? 0x9b59b6)
    .setTimestamp(new Date(log.created_at))
    .addFields(
      { name: 'Categoría', value: log.category ?? '—', inline: true },
      { name: 'Relevancia', value: log.relevance ?? '—', inline: true },
      { name: 'Versión', value: log.version ?? '—', inline: true }
    );

  if (log.description) {
    embed.setDescription(log.description.slice(0, 4000));
  }

  if (Array.isArray(log.tags) && log.tags.length) {
    embed.addFields({ name: 'Tags', value: log.tags.join(', ') });
  }

  // log.content: [{ seccion: "Mob: Esqueleto Cumpleañero", items: [{clave:"Vida", valor:"200"}, ...] }, ...]
  if (Array.isArray(log.content)) {
    for (const seccion of log.content.slice(0, 20)) {
      const lineas = Array.isArray(seccion.items)
        ? seccion.items.map((it) => `**${it.clave}:** ${it.valor}`).join('\n')
        : '';
      if (seccion.seccion && lineas) {
        embed.addFields({ name: seccion.seccion.slice(0, 256), value: lineas.slice(0, 1024) });
      }
    }
  }

  if (process.env.WEBSITE_URL) {
    embed.setURL(process.env.WEBSITE_URL);
    embed.setFooter({ text: 'Culones RPG · Ver en la página' });
  }

  return embed;
}

async function obtenerCanalDeLogs() {
  const { data, error } = await supabaseAdmin
    .from('bot_config')
    .select('value')
    .eq('key', 'logs_channel_id')
    .maybeSingle();

  if (error) {
    console.error('Error leyendo bot_config:', error);
    return null;
  }
  return data?.value ?? null;
}

async function notificarLogNuevo(log) {
  const channelId = await obtenerCanalDeLogs();
  if (!channelId) {
    console.warn('No hay canal configurado. Usa /configurar-canal en Discord.');
    return;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send({ embeds: [buildEmbedFromLog(log)] });
  } catch (err) {
    console.error('No se pudo enviar el embed al canal:', err);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);

  // Escucha inserts y updates en la tabla "logs" en tiempo real
  supabaseAdmin
    .channel('logs-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' }, (payload) => {
      notificarLogNuevo(payload.new);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'logs' }, (payload) => {
      notificarLogNuevo({ ...payload.new, title: `${payload.new.title} (editado)` });
    })
    .subscribe((status) => {
      console.log('Estado de la suscripción realtime:', status);
    });
});

client.login(process.env.DISCORD_BOT_TOKEN);
