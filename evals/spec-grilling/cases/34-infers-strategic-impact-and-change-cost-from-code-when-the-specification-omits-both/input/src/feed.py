def archive_and_publish(row, archive, partners):
    archive.append_immutable(row)
    for partner in partners:
        partner.import_row(row)


def replay(archive, partner):
    for row in archive.all_versions():
        partner.import_row(row)
