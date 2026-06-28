// bot/commands/codigo.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { obtenerOCrearCodigoVigente } = require('../codeManager');

const allowedIds = (process.env.ALLOWED_DISCORD_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('codigo')
    .setDescription('Te envía por DM el código actual para entrar a la cuenta admin de la página'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!allowedIds.includes(interaction.user.id)) {
      await interaction.editReply('No estás autorizado para pedir el código de admin.');
      return;
    }

    try {
      const { code, expiresAt } = await obtenerOCrearCodigoVigente();
      const expiraTexto = `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`;

      await interaction.user.send(
        `Tu código de admin para **Culones RPG** es:\n` +
        `\`\`\`${code}\`\`\`\n` +
        `Expira ${expiraTexto}. No lo compartas con nadie.`
      );

      await interaction.editReply('Te mandé el código por mensaje privado.');
    } catch (err) {
      console.error(err);
      if (err.code === 50007) {
        await interaction.editReply(
          'No pude enviarte el DM. Revisa que tengas los mensajes directos abiertos para este servidor.'
        );
      } else {
        await interaction.editReply('Ocurrió un error generando el código. Intenta de nuevo.');
      }
    }
  },
};
