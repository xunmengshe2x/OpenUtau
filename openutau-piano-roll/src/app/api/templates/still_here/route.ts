import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { USTXData } from '@/types/openutau';

export async function GET() {
  try {
    // Read the still_here.ustx file from the OpenUtau directory
    const filePath = join(process.cwd(), '..', 'still_here.ustx');
    const fileContent = readFileSync(filePath, 'utf8');
    
    // Parse the USTX file
    const ustxData = yaml.load(fileContent) as USTXData;
    
    return NextResponse.json(ustxData);
  } catch (error) {
    console.error('Error loading still_here template:', error);
    return NextResponse.json(
      { error: 'Failed to load template' },
      { status: 500 }
    );
  }
}