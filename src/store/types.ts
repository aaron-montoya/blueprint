import type { Edge, Node } from '@xyflow/react';
import type { PartDefinition, Rotation, WireColor, WireRoute, XY } from '../model/format';

export type PartNodeData = {
  def: PartDefinition;
  label: string;
  rotation: Rotation;
  flip: boolean;
};
export type NoteNodeData = { text: string };
export type SectionNodeData = { label: string; color: string };

export type PartNode = Node<PartNodeData, 'part'>;
export type NoteNode = Node<NoteNodeData, 'note'>;
export type SectionNode = Node<SectionNodeData, 'section'>;
export type DiagramNode = PartNode | NoteNode | SectionNode;

export type WireData = {
  color: WireColor;
  stripe?: WireColor;
  label?: string;
  route: WireRoute;
  points?: XY[];
};
export type WireEdge = Edge<WireData, 'wire'>;

export const isPartNode = (n: DiagramNode): n is PartNode => n.type === 'part';
export const isSectionNode = (n: DiagramNode): n is SectionNode => n.type === 'section';
export const isNoteNode = (n: DiagramNode): n is NoteNode => n.type === 'note';

/** Sections sit behind wires and parts, and are dragged by their label tab. */
export const SECTION_Z = -1;
export const SECTION_DRAG_HANDLE = '.section-tab';
