const nodemailer = require('nodemailer');
const moment = require('moment');
require('moment/locale/pt-br');
const { Redis } = require('@upstash/redis');

const { allowCors } = require('../helpers');

const redis = new Redis({
	url: process.env.UPSTASH_REDIS_REST_URL,
	token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const getHtmlBody = (attendance = 'Não informado', congregation = 'Nordeste', meeting) => {
	return `
        <div style="display: grid">
            <h1 style="text-align: center; background-color: #4a6ca7; color: white; text-transform: uppercase;">
                ${congregation} - ${meeting}
            </h1>
            <h1 style="text-align: center; color: #4a6ca7">Assistência: ${attendance}</h1>
            <img
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/JW_Logo.svg/240px-JW_Logo.svg.png"
                style="display: block; margin-left: auto; margin-right: auto;"
                width="100"
                height="100"
                alt="jw"
                title="jw"
            />
        </div>
    `;
};

const sendEmail = async (req, res) => {
	try {
		const { attendance, id } = req.body;
		const meeting = moment.locale('pt-br') && moment().format('DD/MM/YYYY - dddd');

		const { GMAIL_USER, GMAIL_PASS, EMAIL_TO, ATTENDANCE_ID } = process.env;

		if (ATTENDANCE_ID.toLowerCase() !== id.toLowerCase()) {
			return res.status(401).json({ success: false, message: 'Identificação inválida!' });
		}

		if (!attendance || attendance < 1) {
			return res.status(400).json({ success: false, message: 'Assistência não informada!' });
		}

		const transporter = nodemailer.createTransport({
			service: 'gmail',
			auth: {
				user: GMAIL_USER,
				pass: GMAIL_PASS
			},
		});

		const info = await transporter.sendMail({
			from: GMAIL_USER,
			to: EMAIL_TO,
			subject: `Assistência Nordeste - ${meeting}`,
			html: getHtmlBody(attendance, id, meeting)
		});

		console.log(JSON.stringify(info, null, 4));

		const dateKey = moment().format('YYYY-MM-DD');
		const redisKey = `${id}:${dateKey}`;
		await redis.set(redisKey, attendance);
		console.log(`Redis salvo: ${redisKey} = ${attendance}`);

		res.status(200).json({ success: true, message: 'E-mail enviado com sucesso!' });
	} catch (error) {
		console.error('send-email error:', error?.message, error?.code, error?.responseCode);
		const detail = error?.responseCode === 535 || error?.code === 'EAUTH'
			? 'Falha na autenticação do Gmail. Verifique GMAIL_USER e GMAIL_PASS.'
			: error?.code === 'ECONNECTION' || error?.code === 'ETIMEDOUT'
			? 'Não foi possível conectar ao Gmail. Verifique as variáveis de ambiente.'
			: `Erro interno: ${error?.message || 'desconhecido'}`;
		res.status(500).json({ success: false, message: detail });
	}
};

module.exports = allowCors(sendEmail);