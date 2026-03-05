import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
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

interface FileEntry {
  name: string;
  size?: number;
  type: 'file' | 'dir';
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: TreeNode[];
  size?: number;
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirPaths = new Set<string>();

  for (const file of files) {
    if (file.type === 'dir') {
      dirPaths.add(file.name);
    }
  }

  for (const file of files) {
    const parts = file.name.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      const isFile = i === parts.length - 1 && file.type === 'file';

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

  for (const dirPath of dirPaths) {
    const parts = dirPath.split('/');
    let current = root;
    let found = false;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      const node = current.find((n) => n.name === part);

      if (node) {
        current = node.children;
        if (i === parts.length - 1) found = true;
      } else {
        break;
      }
    }

    if (!found && parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      if (!lastPart) continue;

      const newNode: TreeNode = {
        name: lastPart,
        path: dirPath,
        type: 'dir',
        children: [],
      };

      let parent = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const existing = parent.find((n) => n.name === parts[i]);
        if (existing) {
          parent = existing.children;
        }
      }
      parent.push(newNode);
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
    const sortedChildren = [...node.children].sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <li>
        <div className="flex items-center group">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 flex-1 px-2 py-1 text-sm text-neutral-500 hover:text-neutral-700 rounded hover:bg-neutral-100 text-left"
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
          <button
            type="button"
            onClick={() => onDelete(node.path)}
            className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 hover:bg-neutral-100 mr-1"
            title="Delete folder"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {open && sortedChildren.length > 0 && (
          <ul>
            {sortedChildren.map((child) => (
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateDirModal, setShowCreateDirModal] = useState(false);
  const [selectedDir, setSelectedDir] = useState<string>('');
  const [newDirName, setNewDirName] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-files', agentId],
    queryFn: () => api.listAgentFiles(agentId),
  });

  const files = data?.files ?? [];
  const tree = buildTree(files);
  const sortedTree = [...tree].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });

  const getAllDirs = (nodes: TreeNode[], prefix = ''): { path: string; name: string }[] => {
    const dirs: { path: string; name: string }[] = [];
    for (const node of nodes) {
      if (node.type === 'dir') {
        dirs.push({ path: node.path, name: prefix + node.name });
        dirs.push(...getAllDirs(node.children, `${prefix}${node.name}/`));
      }
    }
    return dirs;
  };

  const allDirs = getAllDirs(tree);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setSelectedDir('');
    setShowUploadModal(true);
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!pendingFile) return;
    try {
      await api.uploadAgentFile(agentId, pendingFile, selectedDir || undefined);
      await queryClient.invalidateQueries({ queryKey: ['agent-files', agentId] });
      toast.success(t('agents.workspace.uploaded'));
      setShowUploadModal(false);
      setPendingFile(null);
    } catch {
      toast.error(t('agents.workspace.uploadError'));
    }
  };

  const createDirMutation = useMutation({
    mutationFn: (path: string) => api.createAgentDir(agentId, path),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-files', agentId] });
      toast.success('Directory created');
      setShowCreateDirModal(false);
      setNewDirName('');
    },
    onError: () => {
      toast.error('Failed to create directory');
    },
  });

  const handleCreateDir = () => {
    if (!newDirName.trim()) return;
    const path = selectedDir ? `${selectedDir}/${newDirName}` : newDirName;
    createDirMutation.mutate(path);
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 flex-1 px-3 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-700 rounded"
        >
          <Upload className="w-4 h-4" />
          {t('agents.workspace.upload')}
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedDir('');
            setShowCreateDirModal(true);
          }}
          className="flex items-center justify-center p-2 text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded"
          title="Create folder"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />

      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-80 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
              <h3 className="text-sm font-semibold text-neutral-900">Upload File</h3>
              <button
                type="button"
                onClick={() => {
                  setShowUploadModal(false);
                  setPendingFile(null);
                }}
                className="p-1 hover:bg-neutral-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-auto">
              <p className="text-xs text-neutral-500">
                File: <span className="font-medium text-neutral-700">{pendingFile?.name}</span>
              </p>
              <div>
                <label
                  htmlFor="upload-destination"
                  className="block text-xs font-medium text-neutral-700 mb-1"
                >
                  Destination
                </label>
                <select
                  id="upload-destination"
                  value={selectedDir}
                  onChange={(e) => setSelectedDir(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-neutral-400"
                >
                  <option value="">/ (root)</option>
                  {allDirs.map((dir) => (
                    <option key={dir.path} value={dir.path}>
                      /{dir.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-neutral-200">
              <button
                type="button"
                onClick={() => {
                  setShowUploadModal(false);
                  setPendingFile(null);
                }}
                className="flex-1 px-3 py-1.5 text-sm border border-neutral-300 rounded hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                className="flex-1 px-3 py-1.5 text-sm bg-neutral-900 text-white rounded hover:bg-neutral-700"
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateDirModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-80">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
              <h3 className="text-sm font-semibold text-neutral-900">Create Folder</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateDirModal(false);
                  setNewDirName('');
                }}
                className="p-1 hover:bg-neutral-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label
                  htmlFor="create-dir-parent"
                  className="block text-xs font-medium text-neutral-700 mb-1"
                >
                  Parent folder
                </label>
                <select
                  id="create-dir-parent"
                  value={selectedDir}
                  onChange={(e) => setSelectedDir(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-neutral-400"
                >
                  <option value="">/ (root)</option>
                  {allDirs.map((dir) => (
                    <option key={dir.path} value={dir.path}>
                      /{dir.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="create-dir-name"
                  className="block text-xs font-medium text-neutral-700 mb-1"
                >
                  Folder name
                </label>
                <input
                  id="create-dir-name"
                  type="text"
                  value={newDirName}
                  onChange={(e) => setNewDirName(e.target.value)}
                  placeholder="my-folder"
                  className="w-full px-2 py-1.5 text-sm border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-neutral-400"
                />
              </div>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-neutral-200">
              <button
                type="button"
                onClick={() => {
                  setShowCreateDirModal(false);
                  setNewDirName('');
                }}
                className="flex-1 px-3 py-1.5 text-sm border border-neutral-300 rounded hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateDir}
                disabled={!newDirName.trim() || createDirMutation.isPending}
                className="flex-1 px-3 py-1.5 text-sm bg-neutral-900 text-white rounded hover:bg-neutral-700 disabled:opacity-50"
              >
                {createDirMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            {sortedTree.map((node) => (
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
