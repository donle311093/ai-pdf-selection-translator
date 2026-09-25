import { Notice } from 'obsidian';
import { PickerSetting as Setting, closePickerWithin } from './picker';
import type PdfSelectionTranslatorPlugin from './main';
import type { TriggerMode } from './core';
import { TARGET_LANGUAGES } from './models';

export class SettingsForm {
  private test: AbortController | null = null;
  private discovery: AbortController | null = null;
  private models: string[] = [];
  private modelContainer!: HTMLElement;
  private customLanguage = false;
  private disposed = false;
  constructor(private container: HTMLElement, private plugin: PdfSelectionTranslatorPlugin) {
    plugin.forms.add(this);
    this.refresh();
  }

  connectionChanged(): void {
    this.discovery?.abort();
    this.models = [];
    this.renderModels();
  }

  refresh(): void {
    this.test?.abort(); this.discovery?.abort();
    const { container, plugin } = this;
    const s = plugin.settings;
    closePickerWithin(container);
    container.empty();
    container.classList.add('pst-settings-container');
    container.createEl('p', { cls: 'pst-settings-intro', text: 'Double-click a word or select a passage to translate it nearby. Translation sends selected text and enabled nearby context to your configured endpoint.' });
    new Setting(container).setName('Model connection').setHeading();
    new Setting(container).setName('Endpoint').setDesc('Enter a Base URL or full /chat/completions endpoint.')
      .addText(text => text.setPlaceholder('https://api.example.com/v1').setValue(s.baseUrl).onChange(async value => {
        s.baseUrl = value.trim(); plugin.connectionChanged(); await plugin.saveSettings();
      }));
    new Setting(container).setName('API Key').setDesc('Leave empty for local services without authentication. Session-only by default.')
      .addText(text => {
        text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.inputEl.spellcheck = false;
        text.setPlaceholder('Enter API key').setValue(s.apiKey).onChange(async value => {
          s.apiKey = value.trim(); plugin.connectionChanged(); await plugin.saveSettings();
        });
      });
    new Setting(container).setName('Remember API key').setDesc('Stores the key in plain text in data.json, which may sync with your configuration. Turning this off removes the saved key but keeps it for this session.')
      .addToggle(toggle => toggle.setValue(s.rememberKey).onChange(async value => { s.rememberKey = value; await plugin.saveSettings(); }));
    this.modelContainer = container.createDiv();
    this.renderModels();
    const languageContainer = container.createDiv();
    const renderLanguage = () => {
      closePickerWithin(languageContainer);
      languageContainer.empty();
      const known = TARGET_LANGUAGES.some(([value]) => value === s.targetLanguage);
      new Setting(languageContainer).setName('Target language').setDesc('Independent of the interface language. Choose a preset or enter your own.')
        .addPicker(d => {
          for (const [value, label] of TARGET_LANGUAGES) d.addOption(value, label);
          d.addOption('__custom__', 'Custom…').setValue(this.customLanguage || !known ? '__custom__' : s.targetLanguage);
          d.onChange(async value => {
            this.customLanguage = value === '__custom__';
            if (!this.customLanguage) { s.targetLanguage = value; await plugin.saveSettings(); }
            renderLanguage();
          });
        });
      if (this.customLanguage || !known) new Setting(languageContainer).setName('Custom target language')
        .addText(text => text.setValue(s.targetLanguage).onChange(async value => { s.targetLanguage = value; await plugin.saveSettings(); }));
    };
    renderLanguage();
    new Setting(container).setName('Reading').setHeading();
    new Setting(container).setName('Translation trigger').setDesc('Translate automatically, on click, or only through a command.')
      .addPicker(d => d.addOptions({ auto: 'Automatic', button: 'Click to translate', command: 'Command / hotkey only' })
        .setValue(s.triggerMode).onChange(async value => { s.triggerMode = value as TriggerMode; await plugin.saveSettings(); }));
    new Setting(container).setName('Selection delay').setDesc('Milliseconds. Reduces calls while adjusting a selection.')
      .addSlider(slider => slider.setLimits(150, 2000, 50).setValue(s.delayMs).onChange(async value => { s.delayMs = value; await plugin.saveSettings(); }));
    new Setting(container).setName('Include nearby context').setDesc('Includes up to 350 characters on each side to clarify terminology.')
      .addToggle(toggle => toggle.setValue(s.includeContext).onChange(async value => { s.includeContext = value; await plugin.saveSettings(); }));
    this.numberSetting('Selection character limit', 'Oversized selections are rejected rather than truncated.', 'maxChars', 100, 20000);
    this.numberSetting('Request timeout (seconds)', 'Stop waiting after this duration.', 'timeoutSeconds', 5, 180);
    new Setting(container).setName('Test and cache').setHeading();
    new Setting(container).setName('Test connection').setDesc('Sends a fixed sentence to test the selected model. Provider charges may apply.')
      .addButton(button => button.setButtonText('Test translation').setCta().onClick(async () => {
        this.test?.abort(); const controller = new AbortController(); this.test = controller;
        button.setDisabled(true).setButtonText('Testing…');
        output.textContent = 'Contacting provider…';
        try {
          const result = await plugin.testConnection(controller);
          if (!this.disposed && !controller.signal.aborted) output.textContent = 'Connection successful\n' + result;
        } catch (error) {
          if (!this.disposed) output.textContent = controller.signal.aborted ? 'Test cancelled.' : this.errorText(error);
        } finally {
          button.setDisabled(false).setButtonText('Test translation');
          if (this.test === controller) this.test = null;
        }
      }));
    const output = container.createDiv({ cls: 'pst-test-result', attr: { 'aria-live': 'polite' } });
    new Setting(container).setName('Clear translation cache').setDesc('The last 100 successful translations are kept only in memory.')
      .addButton(button => button.setButtonText('Clear cache').onClick(() => { plugin.translator.clearCache(); new Notice('Translation cache cleared'); }));
    container.createEl('p', { cls: 'pst-settings-intro', text: 'Supports desktop PDFs with selectable text and Chat Completions compatible services. Assign the translation command in Obsidian hotkey settings.' });
  }

  private renderModels(): void {
    const s = this.plugin.settings;
    closePickerWithin(this.modelContainer);
    this.modelContainer.empty();
    let manual: { setValue(value: string): unknown };
    new Setting(this.modelContainer).setName('Model name').setDesc('Fetch the list to select a model, or enter a model ID manually.')
      .addText(text => { manual = text; text.setPlaceholder('Model ID').setValue(s.model).onChange(async value => {
        s.model = value.trim(); selected?.setValue(this.models.includes(s.model) ? s.model : ''); await this.plugin.saveSettings();
      }); })
      .addButton(button => button.setButtonText('Fetch models').onClick(async () => {
        this.discovery?.abort(); const controller = new AbortController(); this.discovery = controller;
        button.setDisabled(true).setButtonText('Fetching…');
        status.textContent = 'Fetching model list…';
        try {
          const models = await this.plugin.loadModels(controller);
          if (this.disposed || controller.signal.aborted || this.discovery !== controller) return;
          this.models = models; this.renderModels();
        } catch (error) {
          if (!this.disposed && this.discovery === controller) status.textContent = controller.signal.aborted
            ? 'Fetch cancelled. Please retry.' : this.errorText(error);
        } finally {
          button.setDisabled(false).setButtonText('Fetch models');
          if (this.discovery === controller) this.discovery = null;
        }
      }));
    let selected: { setValue(value: string): unknown } | undefined;
    if (this.models.length) new Setting(this.modelContainer).setName('Select model')
      .addPicker(d => {
        selected = d; d.addOption('', 'Choose a model…');
        for (const id of this.models) d.addOption(id, id);
        d.setValue(this.models.includes(s.model) ? s.model : '').onChange(async value => {
          if (!value) return;
          s.model = value; manual.setValue(value); await this.plugin.saveSettings();
        });
      });
    const status = this.modelContainer.createDiv({ cls: 'pst-test-result', attr: { 'aria-live': 'polite' } });
    status.textContent = this.models.length ? `Fetched ${this.models.length} models.` : '';
    this.modelContainer.createEl('p', { cls: 'pst-settings-intro', text: 'Models are listed by your endpoint and key. Use Test translation to confirm chat support; manual entry remains available if listing is unsupported.' });
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : 'Request failed.';
  }

  private numberSetting(name: string, description: string, key: 'maxChars' | 'timeoutSeconds', min: number, max: number): void {
    new Setting(this.container).setName(name).setDesc(description).addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = String(min); text.inputEl.max = String(max);
      text.setValue(String(this.plugin.settings[key]));
      text.inputEl.addEventListener('change', () => {
        const value = Number(text.getValue());
        if (!Number.isFinite(value) || value < min || value > max) {
          new Notice(`Enter a number from ${min} to ${max}.`);
          text.setValue(String(this.plugin.settings[key])); return;
        }
        this.plugin.settings[key] = Math.round(value); void this.plugin.saveSettings();
      });
    });
  }
  destroy(): void {
    closePickerWithin(this.container);
    this.disposed = true; this.test?.abort(); this.discovery?.abort(); this.models = [];
    this.plugin.forms.delete(this);
  }
}
