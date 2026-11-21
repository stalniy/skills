def delete_workspace(db, workspace_id):
    db.execute('UPDATE workspaces SET deleted = true WHERE id = ?', (workspace_id,))
    return {'deleted': True}
