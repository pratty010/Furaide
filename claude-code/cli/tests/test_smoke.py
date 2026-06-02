def test_package_importable():
    import satori
    assert satori.__version__ == "0.1.0"
