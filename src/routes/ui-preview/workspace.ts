import type { Snippet } from 'svelte';
import { movie } from './demo/fixtures';

/** Reference-only layout slots. Editors retain ownership of their drafts. */
export type WorkspaceParts = {
  title: string;
  canvas: Snippet;
  inspector: Snippet;
  browser: Snippet;
};

export type ExampleValues = {
  text: string;
  description: string;
  body: string;
  emphasis: 'standard' | 'subtle';
  size: 'standard' | 'hero' | 'icon';
  disabled: boolean;
  danger: boolean;
  icon: boolean;
  number: number;
  shape: 'poster' | 'fanart' | 'square' | 'circle';
  showCaption: boolean;
  showPrimaryAction: boolean;
};

export const editableExamples = ['Button', 'Avatar', 'Field', 'Heading', 'ProgressBar', 'DetailCard', 'EmptyState', 'MediaCard'] as const;
export const editable = (name: string) => editableExamples.some(value => value === name);
export function exampleDefaults(name: string): ExampleValues {
  return { text: name === 'Button' ? 'Play' : name === 'Avatar' ? 'Alice' : name === 'Field' ? 'Display name' : name === 'EmptyState' ? 'Nothing here yet' : name === 'MediaCard' ? 'The Magicians' : 'Your next favourite', description: 'A little more to explore.', body: 'Stories, people and everything in between.', emphasis: 'standard', size: 'standard', disabled: false, danger: false, icon: true, number: name === 'Avatar' ? 64 : 42, shape: 'fanart', showCaption: true, showPrimaryAction: true };
}

/** Export only genuine component props; slot content and canvas settings stay separate. */
export function exampleConfiguration(name: string, values: ExampleValues, scenario: string) {
  const props: Record<string, unknown> = {};
  const slots: Record<string, string> = {};
  if (name === 'Button') { Object.assign(props, {text: values.text, emphasis: values.emphasis, size: values.size, disabled: values.disabled, danger: values.danger, icon: values.icon ? 'play' : undefined, label: values.text}); }
  else if (name === 'Avatar') Object.assign(props, {name: values.text, size: values.number});
  else if (name === 'Field') {Object.assign(props, {label: values.text, hint: values.description}); slots.children = '<input placeholder="Your display name" />';}
  else if (name === 'Heading') Object.assign(props, {title: values.text, description: values.description});
  else if (name === 'ProgressBar') props.progress = values.number / 100;
  else if (name === 'DetailCard') {Object.assign(props, {title: values.text, description: values.description}); slots.children = values.body;}
  else if (name === 'EmptyState') Object.assign(props, {title: values.text, description: values.description});
  else if (name === 'MediaCard') Object.assign(props, {item: {...movie,title:values.text}, shape: values.shape, showCaption: values.showCaption, showPrimaryAction: values.showPrimaryAction});
  return {component: name, scenario, props, ...(Object.keys(slots).length ? {slots} : {})};
}
