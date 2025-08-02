import stillHereOriginal from './still_here_original.json';
import stillHereSimple from './still_here_simple.json';
import workingScript from './working_script.json';

export interface Template {
  name: string;
  displayName: string;
  description: string;
  ustxData: any;
}

export const TEMPLATES: Template[] = [
  {
    name: 'still_here_original',
    displayName: 'Still Here (Original)',
    description: 'Original melancholic version with full orchestration',
    ustxData: stillHereOriginal
  },
  {
    name: 'still_here_simple', 
    displayName: 'Still Here (Simple)',
    description: 'Simplified version for quick testing',
    ustxData: stillHereSimple
  },
  {
    name: 'working_script',
    displayName: 'Working Script',
    description: 'Test template for development',
    ustxData: workingScript
  }
];

export function getTemplate(name: string): Template | undefined {
  return TEMPLATES.find(template => template.name === name);
}

export function getTemplateNames(): string[] {
  return TEMPLATES.map(template => template.name);
}