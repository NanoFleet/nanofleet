import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileText, Folder, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { api } from '../lib/api';

interface Props {
  agentId: string;
  selectedFile: string | null;
  onSelectFile: (filename: string) => void;
  onFileDeleted?: (filename: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: TreeNode[];
  size?: number;
}

function buildTree(files: { name: string; size: number }[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.name.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      const isFile = i === parts.length - 1;

      let node = current.find((n) => n.name === part);
      if (!node) {
        const newNode: TreeNode = {
          name: part ?? '',
          path,
          type: isFile ? 'file' : 'dir',
          children: [],
          size: isFile ? file.size : undefined,
        };
        current.push(newNode);
        node = newNode;
      }
      current = node.children;
    }
  }

  return root;
}

function TreeNodeItem({
  node,
  agentId,
  selectedFile,
  onSelectFile,
  onDelete,
  depth,
}: {
  node: TreeNode;
  agentId: string;
  selectedFile: string | null;
  onSelectFile: (filename: string) => void;
  onDelete: (filename: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(true);

  if (node.type === 'dir') {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-sm text-neutral-500 hover:text-neutral-700 rounded hover:bg-neutral-100 text-left"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {open ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" />
          )}
          <Folder className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && (
          <ul>
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                agentId={agentId}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                onDelete={onDelete}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        className={`flex items-center gap-2 flex-1 min-w-0 py-1.5 text-sm rounded text-left ${
          selectedFile === node.path
            ? 'bg-neutral-900 text-white'
            : 'text-neutral-700 hover:bg-neutral-100'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        title={node.path}
      >
        <FileText className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
      <button
        type="button"
        onClick={() => onDelete(node.path)}
        className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 hover:bg-neutral-100"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

export function AgentFileExplorer({ agentId, selectedFile, onSelectFile, onFileDeleted }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-files', agentId],
    queryFn: () => api.listAgentFiles(agentId),
  });

  const files = data?.files ?? [];
  const tree = buildTree(files);

  const handleDelete = async (filename: string) => {
    if (!window.confirm(t('agents.workspace.confirmDelete'))) return;
    try {
      await api.deleteAgentFile(agentId, filename);
      await queryClient.invalidateQueries({ queryKey: ['agent-files', agentId] });
      onFileDeleted?.(filename);
      toast.success(t('agents.workspace.deleted'));
    } catch {
      toast.error(t('agents.workspace.deleteError'));
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      await api.uploadAgentFile(agentId, file);
      await queryClient.invalidateQueries({ queryKey: ['agent-files', agentId] });
      toast.success(t('agents.workspace.uploaded'));
    } catch {
      toast.error(t('agents.workspace.uploadError'));
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded w-full"
      >
        <Upload className="w-4 h-4 shrink-0" />
        {t('agents.workspace.upload')}
      </button>
      <input ref={inputRef} type="file" className="hidden" onChange={handleUpload} />

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="animate-pulse space-y-2 pt-1">
            <div className="h-4 bg-neutral-200 rounded w-3/4" />
            <div className="h-4 bg-neutral-200 rounded w-1/2" />
          </div>
        ) : files.length === 0 ? (
          <p className="text-xs text-neutral-400 px-1">{t('agents.workspace.noFiles')}</p>
        ) : (
          <ul className="space-y-0.5">
            {tree.map((node) => (
              <TreeNodeItem
                key={node.path}
                node={node}
                agentId={agentId}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                onDelete={handleDelete}
                depth={0}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
