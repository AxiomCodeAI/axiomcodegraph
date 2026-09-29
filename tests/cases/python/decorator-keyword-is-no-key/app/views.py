from flask import Flask

app = Flask(__name__)


@app.route("/widgets", methods=["GET"])
def list_widgets():
    return "[]"
