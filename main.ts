import { App, Editor, Modal, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, parseFrontMatterTags, getFrontMatterInfo } from 'obsidian';
import NDK, { NDKEvent, NDKPrivateKeySigner, } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'

const now = () => Math.floor(Date.now() / 1000);
const FRONTMATTER_REGEX = /^---\n(.*?\n)*?---\n/g

// Remember to rename these classes and interfaces!

interface NostrWikiSettings {
	privateKey: string;
	relays: string;
}

const DEFAULT_SETTINGS: NostrWikiSettings = {
	privateKey: 'nsec...',
	relays: 'wss://nos.lol'
}

export default class NostrWiki extends Plugin {
	settings: NostrWikiSettings;
	ndk: NDK;
	async onload() {
		await this.loadSettings();
		const relays = this.settings.relays.split(',').map(r => r.trim())
		const decoded = nip19.decode(this.settings.privateKey);
		const signer = new NDKPrivateKeySigner(decoded.data)
		this.ndk = new NDK({
			explicitRelayUrls: relays,
			signer
		});
		await this.ndk.connect();

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'nostr-wiki-publish',
			name: 'Publish the current page',
			editorCallback: async (editor, view: MarkdownView) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return;
				const withoutFrontmatter = stripFrontmatter(view.data);
				const metadata = this.app.metadataCache.getFileCache(file);
				const title = file.basename
				const existingEvent = await this.getExistingEvent(title);
				new PublishModal(this.app, async category => {
					new Notice("Publishing your event...")
					await this.publishEvent(title, withoutFrontmatter, existingEvent, category, metadata?.frontmatter)
					new Notice("Event has been published");
				}, existingEvent).open();

			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new NostrWikiSettingsTab(this.app, this));

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async publishEvent(title: string, data: string, existingEvent?: NDKEvent | null, category?: string, frontmatter?: Record<string, string>) {
		const event = new NDKEvent(this.ndk);
		event.kind = 30818;
		event.content = data
		event.tags.push(['d', normalizeTitle(title)])
		event.tags.push(['title', title])
		if (existingEvent?.tagValue('published_at')) {
			event.tags.push(['published_at', existingEvent.tagValue('published_at')!]);
		} else {
			event.tags.push(['published_at', `${now()}`])
		}
		if (category) {
			event.tags.push(['c', category])
		}
		if (frontmatter) {
			Object.keys(frontmatter).forEach(k => {
				event.tags.push([k, frontmatter[k]])
			})
		}

		await event.publish();
	}

	async getExistingEvent(title: string) {
		const d = normalizeTitle(title);
		const user = await this.ndk.signer!.user()
		const event = await this.ndk.fetchEvent(
			{ kinds: [30818], '#d': [d], authors: [user.pubkey] },
		);
		return event;
	}


}

const normalizeTitle = (title: string) => {
	return title.toLowerCase().replaceAll(' ', '-');
}

const stripFrontmatter = (data: string) => {
	const stripped = data.replaceAll(FRONTMATTER_REGEX, '')
	return stripped
}


class NostrWikiSettingsTab extends PluginSettingTab {
	plugin: NostrWiki;

	constructor(app: App, plugin: NostrWiki) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('nsec')
			.setDesc('Paste in your nsec to sign notes')
			.addText(text => text
				.setPlaceholder('Enter your nsec')
				.setValue(this.plugin.settings.privateKey)
				.onChange(async (value) => {
					this.plugin.settings.privateKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('relays')
			.setDesc('List of relays to connect to, separated by a ,')
			.addText(text => text
				.setValue(this.plugin.settings.relays)
				.onChange(async (value) => {
					this.plugin.settings.relays = value;
					await this.plugin.saveSettings();
				}));
	}
}

export class PublishModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;
	category?: string;

	constructor(app: App, onSubmit: (result: string) => void, existingEvent?: NDKEvent | null) {
		super(app);
		this.onSubmit = onSubmit;
		this.category = existingEvent?.tagValue('c');
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h1", { text: "Publish Settings" });

		new Setting(contentEl)
			.setName("Category (optional)")
			.addText((text) =>
				text.onChange((value) => {
					this.result = value
				}).setValue(this.category ?? ""))

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Publish")
					.setCta()
					.onClick(() => {
						this.close();
						this.onSubmit(this.result);
					}));
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}

