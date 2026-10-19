"""One request per SSH process; never installed on the remote filesystem."""
import base64
import json
import os
import re
import stat
import sys
import unicodedata


# Remote reads load the whole file before local pagination. Refuse files
# that would blow up memory on both machines; bash can slice them instead.
READ_LIMIT_BYTES = 32 * 1024 * 1024


def resolve(request):
    path = request['path']
    if path == '~' or path.startswith('~/'):
        path = os.path.join(os.path.expanduser('~'), path[2:]) if path != '~' else os.path.expanduser('~')
    base = request.get('cwd') or os.getcwd()
    path = os.path.normpath(os.path.join(base, path))
    if request.get('read') and not os.path.exists(path):
        # Match pi's macOS screenshot conveniences on the selected filesystem.
        variants = [re.sub(r' (AM|PM)\.', '\u202f\\1.', path, flags=re.I),
                    unicodedata.normalize('NFD', path), path.replace("'", '\u2019'),
                    unicodedata.normalize('NFD', path).replace("'", '\u2019')]
        path = next((p for p in variants if os.path.exists(p)), path)
    result = {'path': path, 'canonical': os.path.realpath(path)}
    try:
        info = os.stat(path)
        result['identity'] = str(info.st_dev) + ':' + str(info.st_ino)
    except (FileNotFoundError, NotADirectoryError):
        pass
    return result


def run(request):
    op = request['op']
    if op == 'resolve':
        return resolve(request)
    path = request['path']
    if not os.path.isabs(path) or '\0' in path:
        raise ValueError('Expected an absolute remote path without NUL')
    if op == 'read':
        if request.get('editable') and not os.access(path, os.R_OK | os.W_OK):
            raise PermissionError('File is not readable and writable: ' + path)
        with open(path, 'rb') as source:
            size = os.fstat(source.fileno()).st_size
            if size > READ_LIMIT_BYTES:
                raise ValueError(
                    f'Remote file is {size} bytes; the remote read limit is {READ_LIMIT_BYTES} bytes (32 MiB). '
                    'Use bash on the same host to read a slice with head or sed, or split the file first.')
            data = source.read(READ_LIMIT_BYTES + 1)
            if len(data) > READ_LIMIT_BYTES:
                raise ValueError(
                    f'Remote file grew past {READ_LIMIT_BYTES} bytes while reading; the remote read limit is '
                    f'{READ_LIMIT_BYTES} bytes (32 MiB). Use bash on the same host to read a slice.')
            return base64.b64encode(data).decode('ascii')
    if op == 'mkdir':
        os.makedirs(path, exist_ok=True)
        return None
    if op == 'write':
        data = base64.b64decode(request['data'], validate=True)
        with open(path, 'wb') as destination:
            destination.write(data)
        return None
    if op == 'ls':
        if not os.path.exists(path):
            raise FileNotFoundError('Path not found: ' + path)
        if not os.path.isdir(path):
            raise NotADirectoryError('Not a directory: ' + path)
        entries = []
        for name in os.listdir(path):
            try:
                directory = stat.S_ISDIR(os.stat(os.path.join(path, name)).st_mode)
                entries.append({'name': name, 'directory': directory})
            except OSError:
                # Native ls includes the name in its iteration but skips failed stats.
                entries.append({'name': name, 'directory': None})
        return entries
    raise ValueError('Unknown file operation: ' + str(op))


try:
    if sys.version_info < (3, 9):
        raise RuntimeError('pi-ssh file tools require Python 3.9+; upgrade explicitly')
    value = run(json.load(sys.stdin))
    response = {'ok': True, 'value': value}
except Exception as error:
    response = {'ok': False, 'error': str(error)}
print(json.dumps(response, ensure_ascii=True))
