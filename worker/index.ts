import { EmailMessage } from "cloudflare:email";

interface Env {
	R2: R2Bucket;
	ASSETS: Fetcher;
	DISCORD_CONTACT_WEBHOOK: string;
	SEND_EMAIL: SendEmail;
}

interface SendEmail {
	send(message: EmailMessage): Promise<void>;
}

const EXE_KEY = "releases/MakineAI.exe";
const EXE_FILENAME = "MakineAI.exe";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Subdomain redirects are handled by Cloudflare Dynamic Redirect Rule
		// (runs before Workers, catches all *.makineceviri.net → makineceviri.net)

		if (url.pathname === "/download" && request.method === "GET") {
			return handleDownload(env);
		}

		if (url.pathname === "/api/discord-stats" && request.method === "GET") {
			return handleDiscordStats();
		}

		if (url.pathname === "/api/contact" && request.method === "POST") {
			return handleContact(request, env);
		}

		if (url.pathname === "/api/contact" && request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "https://makineceviri.net",
					"Access-Control-Allow-Methods": "POST",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}

		// Serve static assets, fall back to custom 404 page
		const response = await env.ASSETS.fetch(request);
		if (response.status === 404) {
			const notFound = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url)));
			return new Response(notFound.body, { status: 404, headers: notFound.headers });
		}
		return response;
	},
} satisfies ExportedHandler<Env>;

async function handleDiscordStats(): Promise<Response> {
	try {
		const res = await fetch(
			"https://discord.com/api/v10/invites/QDezpy4QtV?with_counts=true"
		);
		if (!res.ok) {
			return new Response("{}", { status: 502, headers: { "Content-Type": "application/json" } });
		}
		const data = (await res.json()) as Record<string, unknown>;
		const stats = {
			members: data.approximate_member_count,
			online: data.approximate_presence_count,
		};
		return new Response(JSON.stringify(stats), {
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "public, max-age=120, s-maxage=300",
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch {
		return new Response("{}", { status: 502, headers: { "Content-Type": "application/json" } });
	}
}

async function handleContact(request: Request, env: Env): Promise<Response> {
	const corsHeaders = {
		"Access-Control-Allow-Origin": "https://makineceviri.net",
		"Content-Type": "application/json",
	};

	if (!env.DISCORD_CONTACT_WEBHOOK) {
		return new Response(JSON.stringify({ error: "Servis yapılandırılmamış." }), {
			status: 503,
			headers: corsHeaders,
		});
	}

	let body: { name?: string; email?: string; subject?: string; message?: string };
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: "Geçersiz istek." }), {
			status: 400,
			headers: corsHeaders,
		});
	}

	const { name, email, subject, message } = body;

	if (!name || !email || !subject || !message) {
		return new Response(JSON.stringify({ error: "Tüm alanları doldurun." }), {
			status: 400,
			headers: corsHeaders,
		});
	}

	if (name.length > 100 || email.length > 200 || subject.length > 200 || message.length > 2000) {
		return new Response(JSON.stringify({ error: "Mesaj çok uzun." }), {
			status: 400,
			headers: corsHeaders,
		});
	}

	// Send to Discord webhook
	const embed = {
		title: `📩 ${subject}`,
		color: 0xd4a843,
		fields: [
			{ name: "Gönderen", value: name, inline: true },
			{ name: "E-posta", value: email, inline: true },
			{ name: "Mesaj", value: message.slice(0, 1024) },
		],
		timestamp: new Date().toISOString(),
		footer: { text: "makineceviri.net/iletisim" },
	};

	const discordPromise = fetch(env.DISCORD_CONTACT_WEBHOOK, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ embeds: [embed] }),
	});

	// Send email via Cloudflare Email Routing (best-effort, don't block on failure)
	if (env.SEND_EMAIL) {
		sendContactEmail(env, name, email, subject, message).catch(() => {});
	}

	try {
		const discordRes = await discordPromise;

		if (!discordRes.ok) {
			return new Response(JSON.stringify({ error: "Mesaj gönderilemedi." }), {
				status: 502,
				headers: corsHeaders,
			});
		}

		return new Response(JSON.stringify({ ok: true }), {
			headers: corsHeaders,
		});
	} catch {
		return new Response(JSON.stringify({ error: "Sunucu hatası." }), {
			status: 500,
			headers: corsHeaders,
		});
	}
}

async function sendContactEmail(env: Env, name: string, email: string, subject: string, message: string): Promise<void> {
	const htmlBody = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#333">
		<div style="background:#07070a;padding:24px 28px;border-radius:12px 12px 0 0">
			<h2 style="color:#d4a843;margin:0;font-size:18px">Yeni İletişim Mesajı</h2>
		</div>
		<div style="background:#f9f9f9;padding:24px 28px;border:1px solid #eee;border-top:none">
			<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
				<tr><td style="padding:6px 0;color:#888;width:90px"><strong>Gönderen</strong></td><td style="padding:6px 0">${escapeHtml(name)}</td></tr>
				<tr><td style="padding:6px 0;color:#888"><strong>E-posta</strong></td><td style="padding:6px 0"><a href="mailto:${escapeHtml(email)}" style="color:#0066cc">${escapeHtml(email)}</a></td></tr>
				<tr><td style="padding:6px 0;color:#888"><strong>Konu</strong></td><td style="padding:6px 0">${escapeHtml(subject)}</td></tr>
			</table>
			<div style="background:#fff;padding:16px 20px;border-radius:8px;border:1px solid #eee;white-space:pre-wrap;line-height:1.6">${escapeHtml(message)}</div>
		</div>
		<div style="background:#07070a;padding:12px 28px;border-radius:0 0 12px 12px;text-align:center">
			<span style="color:#666;font-size:12px">makineceviri.net/iletisim</span>
		</div>
	</div>`;

	const mimeEmail = [
		`From: "Makine Çeviri İletişim" <noreply@makineceviri.net>`,
		`To: iletisim@makineceviri.net`,
		`Reply-To: ${email}`,
		`Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(`[İletişim] ${subject}`)))}?=`,
		`MIME-Version: 1.0`,
		`Content-Type: text/html; charset=UTF-8`,
		`Content-Transfer-Encoding: base64`,
		``,
		btoa(unescape(encodeURIComponent(htmlBody))),
	].join("\r\n");

	const msg = new EmailMessage(
		"noreply@makineceviri.net",
		"iletisim@makineceviri.net",
		new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(mimeEmail));
				controller.close();
			},
		})
	);

	await env.SEND_EMAIL.send(msg);
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function handleDownload(env: Env): Promise<Response> {
	const object = await env.R2.get(EXE_KEY);

	if (!object) {
		return new Response("File not found. Release not yet available.", {
			status: 404,
		});
	}

	const headers = new Headers();
	headers.set("Content-Type", "application/octet-stream");
	headers.set("Content-Disposition", `attachment; filename="${EXE_FILENAME}"`);
	headers.set("Cache-Control", "public, max-age=300, s-maxage=3600");
	headers.set("Accept-Ranges", "bytes");
	headers.set("X-Content-Type-Options", "nosniff");

	if (object.httpEtag) {
		headers.set("ETag", object.httpEtag);
	}
	if (object.size) {
		headers.set("Content-Length", object.size.toString());
	}

	return new Response(object.body, { headers });
}
