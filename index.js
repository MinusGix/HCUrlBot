/* jshint esversion:6 */
let WebSocket = require('ws');
let fs = require('fs');

let storage, config;

try {
	storage = JSON.parse(fs.readFileSync('./JSON/storage.json', 'utf8'));
} catch (err) {
	console.warn('Failure in loading storage. Quitting.');
	throw err;
}

try {
	config  = JSON.parse(fs.readFileSync("./JSON/config.json", 'utf8'));
} catch (err) {
	console.warn('Failure in loading config. Quitting.');
	throw err;
}

let state = {
	trigger: config.trigger,
	channel: config.channel,
	nick: config.nick,
	password: config.password,

	ownerTrip: config.ownerTrip,
	verifiedTrips: storage.verifiedTrips,

	isVerified (trip, strict=false) {
		return (state.verifiedTrips.includes(trip) && !strict) || trip === state.ownerTrip;
	},

	isOwner (trip) {
		return state.isVerified(trip, true);
	},

	tripLength: config.tripLength,
	isTrip (trip) {
		return typeof(trip) === 'string' && trip.trim().length === state.tripLength;
	},

	stripURL (url) {
		return url.toLowerCase()
			.replace(/^(?:http(?:s|)\:\/\/|)(?:www\.|)/, '') // replace the beginning
			.replace(/\/(?:.|\w|\W|\s)*$/, ''); // replace anything after the tld (hopefully)
	},
	retrieveURL (url, forceThrough=false) {
		let text = {};
		let chance = 0.2;

		if (state.urls.hasOwnProperty(url)) {
			chance = 0.4;
			let urlData = state.urls[url];
			if (typeof(urlData) === 'object' && urlData !== null) {
				text = {
					notes: urlData.notes,
					domain: urlData.domain,
					owner: urlData.owner
				};
			} else {
				console.warn('[WARN] urlData for url "', url, '" is not an obj. Ignoring.');
			}
		}

		if (!text.domain) {
			text.domain = url;
		}

		if (!text.owner) {
			text.owner = 'Unknown';
		}

		if (forceThrough === true || Math.random() < chance) {
			return 'DOMAIN: ' + text.domain + '\n' + 'OWNER: ' + text.owner + (text.notes ? '\nNOTES: ' + text.notes.join('\n ') : '');
		}
		return null;
	},
	urls: storage.urls,

	saveStorage () {
		try {
			fs.writeFile("./JSON/storage.json", JSON.stringify({
				urls: state.urls,
				verifiedTrips: state.verifiedTrips
			}), 'utf8', error => {
				if (error) {
					return console.error('[ERROR] in saving storage.', error.toString());
				}
				console.log('Saved storage');
			});
		} catch (err) {
			console.error('[ERROR] in saving storage that was not caught by FS', err.toString());
		}
	}
};

function parseURL (text) {
	return text.match(/(?:\?|https?:\/\/)\S+?(?=[,.!?:)]?\s|$)/g) || [];
}

let client = new WebSocket(config.websocketURL);

function send (data) {
	try {
		if (client.readyState === client.OPEN) {
			client.send(JSON.stringify(data));
		}
	} catch (err) {
		console.err('[ERR] Problem in sending offending object ', data, '\n', err.toString());
	}
}

client.on('open', _ => {
	console.log('connection open');
	send({ cmd: 'join', channel: state.channel, nick: state.nick + '#' + state.password });
});

client.on('message', data => {
	let args;

	try {
		args = JSON.parse(data);
	} catch (err) {
		return console.warn('[WARN] Problem in parsing JSON, most likely an issue with server.');
	}

	if (typeof(args.cmd) !== 'string') {
		return false;
	}

	if (args.cmd === 'chat' && typeof(args.nick) === 'string'  && args.nick !== state.nick && typeof(args.text) === 'string') {
		let text = args.text.split(/\s/);
		
		// .toLowerCase, just in case the trigger is text	
		if (typeof(text[0]) === 'string' && text[0].toLowerCase().startsWith(state.trigger)) {
			
			text[0] = text[0].substring(state.trigger.length).toLowerCase();
			
			if (Commands.hasOwnProperty(text[0]) && Commands[text[0]] && typeof(Commands[text[0]]) === 'function') {
				try {
					let returnedData = Commands[text[0]]({
						text: args.text,
						params: text,
						nick: args.nick,
						trip: args.trip || null,
						admin: args.admin || false,
						mod: args.mod || args.admin || false
					});

					if (typeof(returnedData) === 'string') {
						send({ cmd: 'chat', text: returnedData });
					} else if (typeof(returnedData) === 'object' && returnedData !== null) {
						send(returnedData);
					}
				} catch (err) {
					console.error("There was a problem with the bot, when running the command with the name", text[0], '\n', err.toString());
				}
			}
		} else {
			let urls = [...(
				new Set(
					parseURL(args.text)
						.filter(url => typeof(url) === 'string')
						.map(state.stripURL)
				)
			)].map(state.retrieveURL)
				.filter(urlInfo => typeof(urlInfo) === 'string')
				.join('\n=========\n');

			if (urls.length !== 0) {
				send({
					cmd: 'chat', 
					text: `# MALICIOUS LINK(S) DETECTED\n` + urls
				});
			}
		}
	} else if (args.cmd === 'onlineSet') {
		console.log('logged in');
		setInterval(_ => {
			send({ cmd: 'ping' });
			state.saveStorage();	
		}, 50000);
	}
});

let Commands = {
	help: args => 'Commands:\n' + Object.keys(Commands)
		.map(name => state.trigger + name.toLowerCase())
		.sort()
		.join(', '),
	
	addverify: args => {
		if (state.isOwner(args.trip)) {
			if (typeof(args.params[1]) !== 'string') {
				return 'You must give me an actual trip!';
			}

			if (!state.isTrip(args.params[1])) {
				return 'That does not look like a trip to me.';
			}

			if (state.verifiedTrips.includes(args.params[1].trim())) {
				return 'That trip is already in the verified list.';
			}

			state.verifiedTrips.push(args.params[1].trim());
			return 'Added that trip to the verified list!';
		}
		return "Sorry, but you don't have permission to do that.";
	},

	removeverify: args => {
		if (stat.isOwner(args.trip)) {
			if (typeof(args.params[1]) !== 'string') {
				return 'You must give me an actual trip!';
			}

			if (!state.isTrip(args.params[1])) {
				return 'That does not look like a trip to me.';
			}

			let index = state.verifiedTrips.indexOf(args.params[1].trim());

			if (index === -1) {
				return 'Sorry, (well, not sorry since you wanted to remove it anyway) but that trip does not exist in the list.';
			}

			state.verifiedTrips.splice(index, 1);
			return 'Removed that trip from the verified list';
		}
		return "Sorry, but you don't have permission to do that.";
	},

	listverified: args => state.isOwner(args.trip) ? state.verifiedTrips.join(', ') : "No can do buckaroo, I don't kiss and tell.",

	amiverified: args => state.isVerified(args.trip) ? 'Yes, you are. Please use me babe <3' : 'No, you are not good enough for me.',

	getsiteinfo: args => {
		let urls = [...(
			new Set(
				parseURL(args.params.slice(1).join(' '))
					.filter(url => typeof(url) === 'string')
					.map(state.stripURL)
			)
		)].map(url => state.retrieveURL(url, true))
			.filter(urlInfo => typeof(urlInfo) === 'string')
			.join('\n=========\n');

		if (!urls) {
			return 'You must supply site(s).';
		}

		return '# INFO:\n' + urls;
	},

	customizesite: args => {
		if (state.isVerified(args.trip)) {
			let url = args.params[1];
			let prop = args.params[2];
			let action = args.params[3];
			let edit = args.params.slice(4).join(' ') || null;

			if (typeof(url) !== 'string') {
				return 'You must supply a site url.';
			}

			url = url.toLowerCase();

			if (typeof(prop) !== 'string') {
				return 'You must supply a property that you are editing.';
			}

			if (state.urls[url] && !state.urls.hasOwnProperty(url)) {
				return "I'm sorry, but I can't let you do that. I won't kinkshame you, but there are some things I just can't allow in the bedroom.";
			}
			
			prop = prop.toLowerCase().trim();

			if (prop === 'note') {
				prop = 'notes';
			}

			if (prop !== 'notes' && prop !== 'owner') {
				return 'You must supply a valid property (notes|owner).';
			}

			if (typeof(action) !== 'string') {
				return 'You must supply an action.';
			}

			action = action.toLowerCase();

			if (prop === 'notes' && (action !== 'remove' && action !== 'add' && acton !== 'unset')) {
				return 'That is not a valid action to use on notes. (remove|add|unset)';
			}

			if (prop === 'owner' && (action !== 'set' && action !== 'unset')) {
				return 'That is not a valid action to use on owner. (set|unset)';
			}

			if (typeof(edit) !== 'string' && action !== 'unset') {
				return 'You must give me a string for the property you are editing.';
			}

			let urlData;

			if (state.urls[url]) { // should have been kicked out earlier if it was something like __proto__
				urlData = state.urls[url];
			} else {
				state.urls[url] = urlData = {};
			}

			if (prop === 'notes') {
				if (action === 'add') {
					if (!Array.isArray(urlData.notes)) {
						urlData.notes = [];
					}

					urlData.notes.push(edit);
				} else if (action === 'remove') {
					if (!Array.isArray(urlData.notes)) {
						return 'There is no notes, so we can not remove that note.';
					}

					let index = urlData.notes.indexOf(edit);

					if (index === -1) {
						return 'There is no note with that exact text. Please type it exactly.';
					}

					urlData.notes.splice(index, 1);
				} else if (action === 'unset') {
					if (!Array.isArray(urlData.notes)) {
						return "You can't unset nothing komrade! No nothing? That sounds horrifying.";
					}

					delete urlData.notes;
				} else {
					return 'That action is unsupported. I am not sure how you got past the first check, but please tell MinusGix.';
				}
			} else if (prop === 'owner') {
				if (action === 'set') {
					urlData.owner = edit;
				} else if (action === 'unset') {
					delete urlData.owner;
				} else {
					return 'That action is unsupported. I am not sure how you got past the first check, but please tell MinusGix.';
				}
			} else {
				return 'For some reason the property was unkown despite passing the first test, please report this to MinusGix.';
			}
			return 'Succeeded.';
		}
		return "Sorry, but you don't have permission to do that.";
	}
};