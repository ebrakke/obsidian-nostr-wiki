import { App, Editor, Modal, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import NDK, { NDKEvent, NDKPrivateKeySigner, } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'

const now = () => Math.floor(Date.now() / 1000);

// Remember to rename these classes and interfaces!

interface NostrWikiSettings {
	privateKey: string;
}

const DEFAULT_SETTINGS: NostrWikiSettings = {
	privateKey: 'nsec...'
}

export default class NostrWiki extends Plugin {
	settings: NostrWikiSettings;
	ndk: NDK;
	async onload() {
		await this.loadSettings();
		const decoded = nip19.decode(this.settings.privateKey);
		const signer = new NDKPrivateKeySigner(decoded.data)
		this.ndk = new NDK({
			explicitRelayUrls: ['wss://nos.lol'],
			signer
		});
		await this.ndk.connect();

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'nostr-wiki-publish',
			name: 'Publish the current page',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const title = view.titleEl.innerHTML as string;
				const existingEvent = await this.getExistingEvent(title);
				const data = view.data;
				new PublishModal(this.app, async category => {
					new Notice("Publishing your event...")
					await this.publishEvent(title, data, existingEvent, category)
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

	async publishEvent(title: string, data: string, existingEvent?: NDKEvent | null, category?: string) {
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
