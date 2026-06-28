// bot/commands/configurar-canal.js
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const supabaseAdmin = require('../supabaseAdmin');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('configurar-canal')
    .setDescription('Define en qué canal se publican los logs nuevos de la página')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('canal')
        .setDescription('Canal donde se publicarán los logs')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  async execute(interaction) {
    const canal = interaction.options.getChannel('canal');

    const { error } = await supabaseAdmin
      .from('bot_config')
      .upsert({ key: 'logs_channel_id', value: canal.id });

    if (error) {
      console.error(error);
      await interaction.reply({ content: 'Error guardando la configuración.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      content: `Listo, a partir de ahora los logs nuevos se publicarán en ${canal}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
