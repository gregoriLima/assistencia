const nodemailer = require('nodemailer');
const { Redis } = require('@upstash/redis');

const { allowCors } = require('../helpers');

const TIME_ZONE = 'America/Sao_Paulo';

const redis = new Redis({
	url: process.env.UPSTASH_REDIS_REST_URL,
	token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const getNowParts = (date = new Date()) => {
	const formatter = new Intl.DateTimeFormat('pt-BR', {
		timeZone: TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'long',
	});
	const parts = formatter.formatToParts(date);
	const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
	return {
		dateKey: `${map.year}-${map.month}-${map.day}`,
		meetingLabel: `${map.day}/${map.month}/${map.year} - ${map.weekday}`,
		monthKey: `${map.year}-${map.month}`,
	};
};

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
		const { dateKey, meetingLabel, monthKey } = getNowParts();

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
			subject: `Assistência Nordeste - ${meetingLabel}`,
			html: getHtmlBody(attendance, id, meetingLabel)
		});

		console.log(JSON.stringify(info, null, 4));

		const payload = JSON.stringify({
			attendance: Number(attendance),
			submittedAt: new Date().toISOString(),
		});
		const legacyKey = `${id}:${dateKey}`;
		const monthsKey = `attendance:months:${id}`;
		const monthHashKey = `attendance:${id}:${monthKey}`;

		await redis.set(legacyKey, String(attendance));
		await redis.sadd(monthsKey, monthKey);
		await redis.hset(monthHashKey, { [dateKey]: payload });
		console.log(`Redis salvo: ${legacyKey} = ${attendance}`);
		console.log(`Redis hash salvo: ${monthHashKey}[${dateKey}] = ${payload}`);

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